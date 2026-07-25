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
ASSETS_DIR = ROOT_DIR / "web" / "assets"


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
if DIST_DIR.exists():
    app.mount("/static", StaticFiles(directory=DIST_DIR), name="static")


@app.get("/")
@app.get("/admin")
def index():
    index_html = DIST_DIR / "index.html"
    if index_html.exists():
        return FileResponse(index_html)
    return {"detail": "Frontend build not found — run `npm run build` in client/"}
