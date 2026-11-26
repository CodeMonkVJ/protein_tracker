"""HTTP and SQLite backend for the protein planner. Run with Python 3.10+."""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from http import HTTPStatus
from http.cookies import SimpleCookie, CookieError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
COOKIE = "protein_session"
SESSION_AGE = 60 * 60 * 24 * 30
WEEK = timedelta(days=7)
DEFAULT_GOAL = 120
MAX_PROTEIN = 300
MAX_CHEAT_DAYS = 3
DEFAULT_ACCOUNTS = 8
MAX_ACCOUNTS = 100_000
USER_PATTERN = re.compile(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}")


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def username_from(value):
    if not isinstance(value, str) or not USER_PATTERN.fullmatch(value.strip()):
        raise ApiError(400, "invalid_username", "Use 1–32 letters, numbers, dots, dashes, or underscores. Start with a letter, number, or underscore.")
    return value.strip().lower()


def empty_week():
    return [{"cheat": False, "entries": []} for _ in range(7)]


def plan_number(value, label, minimum, maximum):
    if type(value) not in (int, float) or not minimum <= value <= maximum:
        raise ApiError(400, "invalid_plan", f"{label} must be between {minimum} and {maximum} grams.")
    number = Decimal(str(value))
    if number != number.quantize(Decimal("0.01")):
        raise ApiError(400, "invalid_plan", f"{label} can have up to two decimal places.")
    return float(number)


def validate_days(raw, food_ids):
    if not isinstance(raw, list) or len(raw) != 7:
        raise ApiError(400, "invalid_plan", "A plan must contain exactly seven days.")
    days = []
    for offset, day in enumerate(raw, start=1):
        if not isinstance(day, dict) or type(day.get("cheat")) is not bool or not isinstance(day.get("entries"), list):
            raise ApiError(400, "invalid_plan", "Every day needs a rest day setting and a list of foods.")
        if day["cheat"] and day["entries"]:
            raise ApiError(400, "rest_day_food", "A rest day can’t contain any food.")
        entries = []
        protein = Decimal(0)
        for entry in day["entries"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("foodId"), str) or entry["foodId"] not in food_ids:
                raise ApiError(400, "invalid_food", "Choose a food from the catalog.")
            serving = plan_number(entry.get("serving"), "Serving size", 0.01, 100_000)
            per100 = plan_number(entry.get("proteinPer100"), "Protein per 100 g", 0, 100)
            protein += Decimal(str(serving)) * Decimal(str(per100)) / 100
            entries.append({"foodId": entry["foodId"], "serving": serving, "proteinPer100": per100})
        if protein > MAX_PROTEIN:
            raise ApiError(400, "daily_cap", f"Day {offset} exceeds the {MAX_PROTEIN} g protein limit.")
        days.append({"cheat": day["cheat"], "entries": entries})
    if sum(day["cheat"] for day in days) > MAX_CHEAT_DAYS:
        raise ApiError(400, "rest_day_cap", f"A week can have up to {MAX_CHEAT_DAYS} rest days.")
    return days


def week_signature(days):
    combination = [
        (day["cheat"], sorted(
            (entry["foodId"], entry["serving"], entry["proteinPer100"]) for entry in day["entries"]
        ))
        for day in days
    ]
    return hashlib.sha256(json.dumps(combination, separators=(",", ":")).encode()).hexdigest()


@contextmanager
def database(path):
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


class Store:
    def __init__(self, data_dir, admin_name, admin_key, max_accounts, food_ids):
        self.root = Path(data_dir).resolve()
        if self.root.is_relative_to(PUBLIC.resolve()):
            raise ValueError("PROTEIN_DATA_DIR must be outside the public web directory")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.user_root = self.root / "users"
        self.user_root.mkdir(mode=0o700, exist_ok=True)
        self.registry = self.root / "registry.sqlite3"
        self.admin_name = username_from(admin_name)
        self.food_ids = food_ids
        self.lock = threading.RLock()

        if not 0 <= max_accounts <= MAX_ACCOUNTS:
            raise ValueError(f"PROTEIN_MAX_ACCOUNTS must be between 0 and {MAX_ACCOUNTS}")
        with database(self.registry) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (
                    name TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS accounts (
                    username TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE,
                    zone TEXT NOT NULL, created_at TEXT NOT NULL
                );
            """)
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT OR IGNORE INTO settings VALUES ('max_accounts', ?)", (max_accounts,))
            db.execute("INSERT OR IGNORE INTO settings VALUES ('session_secret', ?)", (secrets.token_hex(32),))
            self.signing_key = bytes.fromhex(self.setting(db, "session_secret"))
            if self.account(db, self.admin_name):
                raise ValueError("PROTEIN_ADMIN_USERNAME conflicts with an existing regular account")
            self.admin_bootstrap = self.root / "admin-key"
            self.admin_key = admin_key or self.read_or_create_admin_key()
            # The superuser has a stable private planner, even if the configured name changes.
            db.execute("INSERT OR IGNORE INTO settings VALUES ('admin_id', ?)", (secrets.token_hex(16),))
            self.admin_id = self.setting(db, "admin_id")

    def read_or_create_admin_key(self):
        try:
            fd = os.open(self.admin_bootstrap, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            key = self.admin_bootstrap.read_text().strip()
            if not key:
                raise ValueError(f"Administrator key file is empty: {self.admin_bootstrap}")
            return key
        key = secrets.token_urlsafe(24)
        with os.fdopen(fd, "w") as file:
            file.write(key + "\n")
        print(f"Admin account: {self.admin_name}. Setup key saved to {self.admin_bootstrap}", flush=True)
        return key

    @staticmethod
    def setting(db, key):
        return db.execute("SELECT value FROM settings WHERE name = ?", (key,)).fetchone()[0]

    @staticmethod
    def account(db, username):
        return db.execute("SELECT * FROM accounts WHERE username = ?", (username,)).fetchone()

    @staticmethod
    def browser_zone(value):
        if value is None:
            return "UTC"
        if not isinstance(value, str) or len(value) > 128:
            raise ApiError(400, "invalid_timezone", "Choose a valid time zone.")
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ApiError(400, "invalid_timezone", "Choose a valid time zone.") from None
        return value

    def login(self, data):
        username = username_from(data.get("username"))
        if username == self.admin_name:
            supplied = data.get("adminKey")
            if not isinstance(supplied, str) or not hmac.compare_digest(
                supplied.encode(errors="surrogatepass"), self.admin_key.encode()
            ):
                raise ApiError(403, "admin_key", "Enter the administrator access key.")
            return self.admin_profile(self.browser_zone(data.get("timezone")))
        with database(self.registry) as db:
            db.execute("BEGIN IMMEDIATE")
            account = self.account(db, username)
            if account:
                return dict(account)
            if data.get("create") is not True:
                raise ApiError(404, "new_user", "That username is new. Create an account?")
            count = db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
            if count >= int(self.setting(db, "max_accounts")):
                raise ApiError(409, "account_limit", "All account slots are taken.")
            account = {
                "username": username,
                "id": secrets.token_hex(16),
                "zone": self.browser_zone(data.get("timezone")),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            db.execute(
                "INSERT INTO accounts VALUES (:username, :id, :zone, :created_at)",
                account,
            )
            return account

    def admin_profile(self, zone):
        return {"username": self.admin_name, "id": self.admin_id, "zone": zone, "isAdmin": True}

    def sign(self, payload, is_admin):
        key = self.signing_key
        if is_admin:
            key = hmac.digest(key, self.admin_key.encode(), "sha256")
        return hmac.new(key, payload, hashlib.sha256).hexdigest()

    def issue_session(self, profile):
        value = [profile["username"], profile["id"], profile["zone"], int(time.time()) + SESSION_AGE]
        payload = base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode())
        return f"{payload.decode()}.{self.sign(payload, profile.get('isAdmin', False))}"

    def session(self, token):
        try:
            payload, signature = token.encode().split(b".", 1)
            is_admin = hmac.compare_digest(signature, self.sign(payload, True).encode())
            if not is_admin and not hmac.compare_digest(signature, self.sign(payload, False).encode()):
                return None
            username, ident, zone, expiry = json.loads(base64.urlsafe_b64decode(payload))
            if expiry < time.time():
                return None
            if is_admin:
                return self.admin_profile(zone) if ident == self.admin_id and username == self.admin_name else None
            with database(self.registry) as db:
                account = self.account(db, username)
                return dict(account) if account and account["id"] == ident else None
        except (TypeError, ValueError, UnicodeError):
            return None

    def admin_state(self, db):
        return {
            "maxAccounts": int(self.setting(db, "max_accounts")),
            "users": [
                {"username": row["username"], "createdAt": row["created_at"]}
                for row in db.execute("SELECT * FROM accounts ORDER BY created_at, username")
            ],
        }

    def admin(self, method, data, username=None):
        with database(self.registry) as db:
            if method == "PUT":
                limit = data.get("maxAccounts")
                if type(limit) is not int or not 0 <= limit <= MAX_ACCOUNTS:
                    raise ApiError(400, "invalid_limit", f"Set the account limit between 0 and {MAX_ACCOUNTS}.")
                db.execute("UPDATE settings SET value = ? WHERE name = 'max_accounts'", (limit,))
            elif method == "DELETE":
                account = self.account(db, username_from(username))
                if not account:
                    raise ApiError(404, "unknown_user", "That account does not exist.")
                db.execute("DELETE FROM accounts WHERE id = ?", (account["id"],))
                (self.user_root / f"{account['id']}.sqlite3").unlink(missing_ok=True)
            return self.admin_state(db)

    def plan(self, profile, method, data):
        today = datetime.now(ZoneInfo(profile["zone"])).date()
        with database(self.user_root / f"{profile['id']}.sqlite3") as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS plan (
                    slot INTEGER PRIMARY KEY CHECK (slot = 1),
                    start_date TEXT NOT NULL, goal REAL NOT NULL, days TEXT NOT NULL,
                    version INTEGER NOT NULL, renewed INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signature TEXT NOT NULL UNIQUE, start_date TEXT NOT NULL, days TEXT NOT NULL
                );
            """)
            db.execute("BEGIN IMMEDIATE")
            # Commit rollover separately so a stale save cannot roll it back.
            self.roll_over(db, today)
        with database(self.user_root / f"{profile['id']}.sqlite3") as db:
            db.execute("BEGIN IMMEDIATE")
            plan = db.execute("SELECT * FROM plan").fetchone()
            if method != "GET":
                if type(data.get("version")) is not int or data["version"] != plan["version"]:
                    raise ApiError(409, "stale_plan", "Your plan changed. Refresh it and try again.")
                if method == "PUT":
                    days = validate_days(data.get("days"), self.food_ids)
                    goal = plan_number(data.get("goal"), "Daily target", 1, MAX_PROTEIN)
                else:
                    template_id = data.get("id")
                    if type(template_id) is not int or not 1 <= template_id < 2**63:
                        raise ApiError(400, "invalid_template", "Choose a saved week.")
                    template = db.execute("SELECT days FROM templates WHERE id = ?", (template_id,)).fetchone()
                    if not template:
                        raise ApiError(404, "invalid_template", "That saved week is no longer available.")
                    days = json.loads(template["days"])
                    goal = plan["goal"]
                db.execute(
                    "UPDATE plan SET goal = ?, days = ?, version = version + 1, renewed = 0",
                    (goal, json.dumps(days)),
                )
            return self.plan_state(db, today)

    @staticmethod
    def roll_over(db, today):
        plan = db.execute("SELECT * FROM plan").fetchone()
        if not plan:
            db.execute(
                "INSERT INTO plan VALUES (1, ?, ?, ?, 1, 0)",
                (today.isoformat(), DEFAULT_GOAL, json.dumps(empty_week())),
            )
            return
        start = datetime.strptime(plan["start_date"], "%Y-%m-%d").date()
        if today < start + WEEK:
            return
        days = json.loads(plan["days"])
        if any(day["entries"] or day["cheat"] for day in days):
            signature = week_signature(days)
            db.execute("DELETE FROM templates WHERE signature = ?", (signature,))
            db.execute(
                "INSERT INTO templates (signature, start_date, days) VALUES (?, ?, ?)",
                (signature, plan["start_date"], plan["days"]),
            )
            db.execute("DELETE FROM templates WHERE id NOT IN (SELECT id FROM templates ORDER BY id DESC LIMIT 5)")
        db.execute(
            "UPDATE plan SET start_date = ?, days = ?, version = version + 1, renewed = 1",
            (today.isoformat(), json.dumps(empty_week())),
        )

    @staticmethod
    def plan_state(db, today):
        plan = db.execute("SELECT * FROM plan").fetchone()
        start = datetime.strptime(plan["start_date"], "%Y-%m-%d").date()
        return {
            "today": today.isoformat(),
            "startDate": plan["start_date"],
            "goal": plan["goal"],
            "version": plan["version"],
            "renewed": bool(plan["renewed"]),
            "days": [
                {"date": (start + timedelta(days=offset)).isoformat(), **day}
                for offset, day in enumerate(json.loads(plan["days"]))
            ],
            "templates": [
                {"id": row["id"], "startDate": row["start_date"], "days": json.loads(row["days"])}
                for row in db.execute("SELECT * FROM templates ORDER BY id DESC")
            ],
        }


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    @property
    def url_path(self):
        return unquote(urlsplit(self.path).path)

    @property
    def is_api(self):
        return self.url_path == "/api" or self.url_path.startswith("/api/")

    @staticmethod
    def public_profile(profile):
        return {"username": profile["username"], "isAdmin": profile.get("isAdmin", False)}

    def send_json(self, status, data, cookie=None):
        body = json.dumps(data, allow_nan=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store" if self.is_api else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def get_data(self):
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "invalid_content_type", "Send an application/json request.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "invalid_content_length", "The request length is invalid.") from None
        if not 0 < length <= 256 * 1024:
            raise ApiError(413, "invalid_content_length", "The request must contain at most 256 KB of data.")
        try:
            data = json.loads(self.rfile.read(length))
        except (UnicodeError, ValueError, RecursionError):
            raise ApiError(400, "invalid_json", "Send valid JSON.") from None
        if not isinstance(data, dict):
            raise ApiError(400, "invalid_json", "The request must be a JSON object.")
        return data

    def session_cookie(self, value, max_age):
        cookie = SimpleCookie()
        cookie[COOKIE] = value
        cookie[COOKIE]["httponly"] = True
        cookie[COOKIE]["path"] = "/"
        cookie[COOKIE]["samesite"] = "Strict"
        cookie[COOKIE]["max-age"] = max_age
        if self.server.secure_cookie:
            cookie[COOKIE]["secure"] = True
        return cookie[COOKIE].OutputString()

    def get_profile(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        if COOKIE not in cookie:
            return None
        return self.server.store.session(cookie[COOKIE].value)

    def dispatch_api(self):
        store = self.server.store
        path = self.url_path
        method = self.command
        data = self.get_data() if method in ("POST", "PUT") else {}
        expected_username = self.headers.get("X-Plan-Username")
        cookie = None
        with store.lock:
            if path == "/api/session" and method == "POST":
                profile = store.login(data)
                cookie = self.session_cookie(store.issue_session(profile), SESSION_AGE)
                result = self.public_profile(profile)
            elif path == "/api/session" and method == "DELETE":
                if expected_username:
                    profile = self.get_profile()
                    if profile and profile["username"] != expected_username:
                        raise ApiError(401, "sign_in_required", "The active account changed. Sign in again.")
                cookie = self.session_cookie("", 0)
                result = {"signedOut": True}
            else:
                profile = self.get_profile()
                if profile is None:
                    raise ApiError(401, "sign_in_required", "Sign in to open your account.")
                if expected_username is not None and profile["username"] != expected_username:
                    raise ApiError(401, "sign_in_required", "The active account changed. Sign in again.")
                if path == "/api/session" and method == "GET":
                    result = self.public_profile(profile)
                elif (path == "/api/plan" and method in ("GET", "PUT")) or (
                    path == "/api/plan/reuse" and method == "POST"
                ):
                    result = store.plan(profile, method, data)
                elif path == "/api/admin" and method in ("GET", "PUT"):
                    self.require_admin(profile)
                    result = store.admin(method, data)
                elif path.startswith("/api/admin/users/") and method == "DELETE":
                    self.require_admin(profile)
                    result = store.admin(method, data, path.removeprefix("/api/admin/users/"))
                else:
                    raise ApiError(404, "not_found", "That endpoint does not exist.")
        self.send_json(200, result, cookie)

    @staticmethod
    def require_admin(profile):
        if not profile.get("isAdmin"):
            raise ApiError(403, "admin_required", "Only the administrator can manage accounts.")

    def handle_api(self):
        try:
            self.dispatch_api()
        except ApiError as error:
            self.send_json(error.status, {"code": error.code, "error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            logging.exception("Request failed")
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"code": "server_error", "error": "The server could not complete this request."})

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path /= "index.html"
        if not path.resolve().is_relative_to(PUBLIC.resolve()):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_GET(self):
        if self.is_api:
            self.handle_api()
        else:
            super().do_GET()

    def do_HEAD(self):
        if self.is_api:
            self.send_json(405, {"code": "method_not_allowed", "error": "Use GET for this endpoint."})
        else:
            super().do_HEAD()

    def do_POST(self):
        if self.is_api:
            self.handle_api()
        else:
            self.send_error(405)

    do_PUT = do_POST
    do_DELETE = do_POST


def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO)
    catalog = json.loads((PUBLIC / "catalog.json").read_text())
    store = Store(
        data_dir=os.getenv("PROTEIN_DATA_DIR", str(ROOT / "data")),
        admin_name=os.getenv("PROTEIN_ADMIN_USERNAME", "admin"),
        admin_key=os.getenv("PROTEIN_ADMIN_KEY"),
        max_accounts=int(os.getenv("PROTEIN_MAX_ACCOUNTS", str(DEFAULT_ACCOUNTS))),
        food_ids={item["id"] for item in catalog},
    )
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    with ThreadingHTTPServer((host, port), Handler) as server:
        server.store = store
        server.secure_cookie = os.getenv("PROTEIN_COOKIE_SECURE", "0") == "1"
        print(f"Protein planner listening at http://{host}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
