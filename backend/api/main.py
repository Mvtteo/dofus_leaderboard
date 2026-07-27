from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from dofus_leaderboard.database import SessionLocal
from dofus_leaderboard.settings_store import load_settings

from .routers import admin, public

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DIST_DIR = ROOT_DIR / "dist"
WEB_DIR = ROOT_DIR / "web"
ASSETS_DIR = WEB_DIR / "assets"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        load_settings(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Dofus Leaderboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(admin.router)

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
    # Le front référence aussi certaines images en /web/assets/... (favicon, logo header) —
    # même dossier, deuxième préfixe, pour matcher les deux chemins utilisés côté client.
    app.mount("/web/assets", StaticFiles(directory=ASSETS_DIR), name="web-assets")
# Chunks JS/CSS buildés par Vite (assetsDir: 'app' dans vite.config.js — volontairement
# pas /assets, déjà pris par ASSETS_DIR ci-dessus pour les images du jeu).
if (DIST_DIR / "app").exists():
    app.mount("/app", StaticFiles(directory=DIST_DIR / "app"), name="app-assets")


@app.get("/")
@app.get("/admin")
def index():
    index_html = DIST_DIR / "index.html"
    if index_html.exists():
        return FileResponse(index_html)
    return {"detail": "Frontend build not found — run `npm run build` in client/"}
