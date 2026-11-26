# Protein Club

An installable, seven-day protein planner. Start with a daily target, choose foods and serving sizes for each day, and carry a saved week into the next one.

## Run locally

Python 3.10 or newer is required. The app uses the Python standard library and SQLite.

```sh
python3 server.py
```

Open [Protein Club](http://127.0.0.1:8000). Choose **Enter username** to open an existing account or confirm a new one. Usernames are case-insensitive. The browser remembers the username, and you can re-enter it after clearing browser storage.

## Run with Docker

Run these commands in the repository on the app server:

```sh
mkdir -p -m 700 "$PWD/data"
docker build -t protein-club .
docker run -d --name protein-club --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  --publish 0.0.0.0:47391:8000 \
  --mount "type=bind,source=$PWD/data,target=/data" \
  protein-club
```

Open `http://<server-ip>:47391`. Docker maps port 47391 on all IPv4 interfaces to port 8000 inside the container.

The container stores its SQLite files and generated admin key in `/data`, which maps to the host directory you mounted. Replace `$PWD/data` with any existing absolute host path owned by the user running the container. Use one server per data directory. Stop the native server before mounting its existing data, or use a separate directory and host port.

## Admin setup

Sign in as `admin` through **Admin sign-in** in the username dialog. On first launch the server writes a generated admin key to `data/admin-key`. Retrieve it locally or set `PROTEIN_ADMIN_KEY` before starting the server. In **Manage accounts**, you can change the account limit and delete member accounts. The default limit is eight members and excludes the admin.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PROTEIN_MAX_ACCOUNTS` | `8` | Sets the starting member limit when initializing a new data directory. |
| `PROTEIN_ADMIN_USERNAME` | `admin` | Sets the reserved admin username. |
| `PROTEIN_ADMIN_KEY` | Generated key | Sets the key required for admin login. |
| `PROTEIN_DATA_DIR` | `data/` locally, `/data` in Docker | Stores the account registry, admin key, and per-account SQLite files. |
| `HOST` | `127.0.0.1` locally, `0.0.0.0` in Docker | Controls the bind address. |
| `PORT` | `8000` | Controls the HTTP port. |
| `PROTEIN_COOKIE_SECURE` | `0` | Set to `1` to enable secure session cookies for HTTPS. |

Regular accounts use username-only access. Anyone who knows a member's username can open that account, so use this with a trusted group. Back up the data directory to preserve plans. Use HTTPS if serving the app beyond localhost.

## Plan a week

- Each plan covers seven days starting on the date it opens, based on the account's time zone. All seven days stay editable until the plan rolls over.
- The daily goal starts at 120 g and can be changed. A food's protein contribution is its serving weight multiplied by its protein per 100 g, divided by 100. The app caps the daily total at 300 g.
- Use up to three cheat days per week. Cheat days carry no servings or protein target. The day controls also let you swap the contents of any two days.
- After rollover, **Past weeks** lets you reuse one of the five most recent distinct schedules. Reusing a schedule copies its servings and cheat days into the current dates.

The food library lists reference estimates from USDA FoodData Central, ICMR–NIN's Indian Food Composition Tables, and representative product labels. Match the listed preparation and weigh the edible portion, or use the value from your package. [Food catalog and nutrition references](public/catalog.json)

## Install the PWA

Use **Install app** when it appears or use the browser's install or add-to-home-screen menu. Installation and the offline shell are available on localhost and HTTPS. The app and food library can reopen offline after an online visit. Signing in, retrieving your plan, and saving changes require the server.

## Artwork

The hero render and food sprites were made with built-in ImageGen and packaged as transparent WebP files in [public/images](public/images). The hero floats and the food sprites lift on hover, with both effects following the browser's reduced-motion preference.

<details>
<summary>ImageGen prompts</summary>

**Hero plate**

> Use case: stylized-concept. One transparent hero illustration for a modern protein planner dashboard. A high-end isometric 3D product render of a small rounded shallow off-white ceramic plate, viewed from 45 degrees, filled with sliced golden grilled chicken breast with dark sear marks, halved soft boiled eggs with bright orange yolk, green edamame and broccoli, a tiny dusting of black pepper, arranged with deliberate clean spacing. The plate is an oval in perspective and is tilted slightly diagonally from upper-right to bottom-left. Soft beautiful studio illumination from upper left, tactile realistic food, editorial quality, appetizing saturated greens and golden hues. Entire isolated plate within frame, center and fill frame with a little breathing room. Tiny few green leaves and a cooked prawn float just above the upper right of the plate as a restrained dimensional detail. Single transparent cutout composition, no surrounding scene, no checkerboard, no background, no typography, no props and no separate bowls.

**Food sprites**

> Create one UI sprite atlas of 16 isolated realistic isometric 3D food miniatures for a modern protein planner. Exactly FOUR columns and FOUR rows in a SQUARE image. Think of an invisible 4 by 4 grid of equal cells, each food subject centered exactly in its cell, with generous fully transparent margins on each side. All are lit from the upper-left with luminous tactile realistic materials and a coherent friendly editorial food-render style. Every object separated from other cells. Transparent background throughout; no plates under most objects, no type, no cell borders, no labels, no gradients covering canvas. Exact items reading left to right by row: row 1 = (1) golden sliced grilled chicken breast with sear marks, (2) seared cubed mutton, (3) two orange curled cooked prawns, (4) three white paneer cubes with light brown grilled faces; row 2 = (5) two cubed fluffy plain tofu blocks, (6) a small mound of tan dry soya chunks, (7) pale lilac ramekin with a swirl of creamy Greek yogurt and a few blueberries, (8) tilted mauve scoop filled with pale protein powder; row 3 = (9) whole brown egg next to boiled egg half with orange yolk, (10) thin golden textured tempeh slices showing beans, (11) a little pale orange ceramic bowl with rolled oats, (12) short plain open jar of peanut butter and two peanuts; row 4 = (13) salmon fillet with skin and fine white striations, (14) open metal can with flaked tuna, (15) golden roast chicken drumstick with exposed bone, (16) two short browned grilled sausages. One consistent scale and angle. Do not add other subjects. Must have clear transparent gutters for software cropping.

</details>
