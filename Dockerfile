FROM python:3.12-slim-bookworm

ENV HOST=0.0.0.0 \
    PORT=8000 \
    PROTEIN_DATA_DIR=/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN install -d -m 0700 -o 1000 -g 1000 /data
COPY server.py ./
COPY public/ ./public/

USER 1000:1000
EXPOSE 8000
STOPSIGNAL SIGINT

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/', timeout=3).close()"]

CMD ["python", "server.py"]
