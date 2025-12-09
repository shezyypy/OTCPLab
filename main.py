import asyncio
import nest_asyncio
from datetime import datetime, timedelta, time as dtime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
import aiofiles
import openpyxl
from sqlmodel import Session

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

from db import (
    create_db_and_tables,
    get_session,
    User,
    ModelItem,
    PendingModel,
    Booking, engine,
)

BOT_TOKEN = token
WEBAPP_URL = url
ADMIN_ID = id

BASE_DIR = Path(__file__).parent
UPLOADS_MODELS = BASE_DIR / "uploads" / "models"
UPLOADS_IMAGES = BASE_DIR / "uploads" / "images"
PENDING_DIR = BASE_DIR / "uploads" / "pending"
for p in (UPLOADS_MODELS, UPLOADS_IMAGES, PENDING_DIR):
    p.mkdir(parents=True, exist_ok=True)

create_db_and_tables()

app = FastAPI(title="3D Printer MiniApp Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "webapp" / "static")), name="static")
app.mount("/storage/models", StaticFiles(directory=str(UPLOADS_MODELS)), name="models")
app.mount("/storage/images", StaticFiles(directory=str(UPLOADS_IMAGES)), name="images")
app.mount("/storage/pending", StaticFiles(directory=str(PENDING_DIR)), name="pending")

SLOT_DURATION_MIN = 60
OPEN_HOUR = 9
CLOSE_HOUR = 21

def generate_day_slots(day_offset=0):
    now = datetime.now()
    day = (now + timedelta(days=day_offset)).date()
    slots = []
    for h in range(OPEN_HOUR, CLOSE_HOUR):
        start = datetime.combine(day, dtime(hour=h))
        end = start + timedelta(minutes=SLOT_DURATION_MIN)
        if start > now:
            slots.append({"start": start.isoformat(), "end": end.isoformat()})
    return slots

def is_conflict(start_dt, end_dt):
    with get_session() as s:
        q = select(Booking).where((Booking.start_at < end_dt) & (Booking.end_at > start_dt))
        return s.exec(q).scalars().first() is not None

@app.get("/", response_class=HTMLResponse)
async def index():
    return (BASE_DIR / "webapp" / "index.html").read_text(encoding="utf-8")

@app.get("/api/models")
async def api_models():
    with get_session() as s:
        rows = s.exec(select(ModelItem).order_by(ModelItem.uploaded_at.desc())).scalars().all()
    out = [{"id": r.id, "title": r.title, "file": f"/storage/models/{r.filename}", "image": (f"/storage/images/{r.image}" if r.image else None)} for r in rows]
    return JSONResponse(out)

from fastapi.responses import JSONResponse

@app.post("/api/submit_model")
async def api_submit_model(
    title: str = Form(...),
    file: UploadFile = File(...),
    image: UploadFile = File(None),
    tg_user: int = Form(None)
):
    ts = int(datetime.now().timestamp())
    fname = f"{ts}_{file.filename}"
    fpath = PENDING_DIR / fname
    async with aiofiles.open(fpath, "wb") as out:
        await out.write(await file.read())
    imgname = None
    if image:
        imgname = f"{ts}_{image.filename}"
        ipath = UPLOADS_IMAGES / imgname
        async with aiofiles.open(ipath, "wb") as out:
            await out.write(await image.read())
    with get_session() as s:
        pm = PendingModel(submitter_tg=tg_user, title=title, filename=fname, image=imgname)
        s.add(pm)
        s.commit()
        s.refresh(pm)

    # возвращаем **явно JSON и код 200**
    return JSONResponse(content={"success": True, "message": "Модель отправлена на модерацию", "pending_id": pm.id})


@app.get("/api/pending_models")
async def api_pending_models():
    with get_session() as s:
        rows = s.exec(select(PendingModel).where(PendingModel.moderated == False).order_by(PendingModel.created_at.desc())).scalars().all()
    out = [{"id": r.id, "title": r.title, "file": f"/storage/pending/{r.filename}", "image": (f"/storage/images/{r.image}" if r.image else None), "submitter": r.submitter_tg} for r in rows]
    return JSONResponse(out)

@app.post("/api/admin/approve_model")
async def api_approve_model(payload: dict):
    pend_id = payload.get("pending_id") or payload.get("id") or payload.get("pendingId")
    if pend_id is None:
        raise HTTPException(400, "pending_id required")
    with get_session() as s:
        pm = s.get(PendingModel, int(pend_id))
        if not pm:
            raise HTTPException(404, "Not found")
        src = PENDING_DIR / pm.filename
        dst = UPLOADS_MODELS / pm.filename
        if src.exists():
            src.replace(dst)
        if pm.image:
            # image already in UPLOADS_IMAGES
            pass
        lib = ModelItem(title=pm.title, filename=pm.filename, image=pm.image)
        s.add(lib)
        pm.moderated = True
        s.add(pm)
        s.commit()
        s.refresh(lib)
    return {"ok": True, "model_id": lib.id}

@app.post("/api/book/cancel")
async def cancel_booking(data: dict, session: Session = Depends(get_session)):
    booking_id = data.get("booking_id")
    tg_user = data.get("tg_user")

    if not booking_id:
        return {"error": "Не указан ID бронирования"}

    booking = session.get(Booking, booking_id)
    if not booking:
        return {"error": "Бронирование не найдено"}

    # Проверяем, если это клиент — может отменять только свою бронь
    if tg_user and booking.tg_user != tg_user:
        return {"error": "Вы не можете отменить чужое бронирование"}

    session.delete(booking)
    session.commit()

    return {"ok": True, "message": "Бронирование успешно отменено"}

@app.get("/api/slots/{day}")
async def api_slots(day: str, s: Session = Depends(get_session)):
    from datetime import datetime, timedelta, time

    try:
        # если передан индекс (0, 1, 2), то это смещение от текущей даты
        if day.isdigit():
            date_obj = (datetime.utcnow().date() + timedelta(days=int(day)))
        else:
            date_obj = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    # получаем все бронирования за день
    bookings = s.exec(select(Booking)).all()
    bookings_today = [b for b in bookings if b.start_at.date() == date_obj]

    now = datetime.utcnow()
    slots = []

    for hour in range(9, 21):
        start = datetime.combine(date_obj, time(hour=hour))
        end = datetime.combine(date_obj, time(hour=hour + 1))

        # проверяем занятость
        busy = any(b.start_at <= start < b.end_at for b in bookings_today)

        # по умолчанию слот доступен
        available = not busy

        # если сегодня — скрываем прошедшие часы
        if date_obj == now.date() and start <= now:
            available = False

        slots.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "available": available
        })

    return slots


from sqlmodel import select
from fastapi import HTTPException, Depends
from datetime import datetime

@app.post("/api/book")
async def create_booking(data: dict, session: Session = Depends(get_session)):
    tg_user = data.get("tg_user")
    printer_id = data.get("printer_id", 1)
    start = data.get("start") or data.get("start_time")
    end = data.get("end") or data.get("end_time")

    if not all([tg_user, start, end]):
        raise HTTPException(400, "Отсутствуют обязательные поля (tg_user, start, end)")

    # ✅ корректный запрос, возвращающий объект User
    statement = select(User).where(User.tg_id == tg_user)
    result = session.exec(statement)
    user = result.first()  # 👈 scalars() делает ORM-объект, а не Row

    if not user:
        user = User(tg_id=tg_user, name=f"User {tg_user}")
        session.add(user)
        session.commit()
        session.refresh(user)

    start_dt = datetime.fromisoformat(start)
    end_dt = datetime.fromisoformat(end)

    overlap = session.exec(
        select(Booking).where(
            Booking.start_at < end_dt,
            Booking.end_at > start_dt
        )
    ).first()
    if overlap:
        raise HTTPException(400, "Это время уже занято")

    # ✅ создаём бронь с user_id
    booking = Booking(
        user_id=user.id,
        tg_user=tg_user,
        printer_id=printer_id,
        start_at=start_dt,
        end_at=end_dt,
        created_at=datetime.utcnow(),
        status="active"
    )

    session.add(booking)
    session.commit()
    session.refresh(booking)

    return {"ok": True, "booking_id": booking.id}




@app.get("/api/bookings")
async def api_bookings(all: bool = False, tg_user: int = None):
    with get_session() as s:
        q = select(Booking).order_by(Booking.start_at)
        if not all and tg_user:
            q = q.where(Booking.tg_user == int(tg_user))
        rows = s.exec(q).all()

    out = [
        {
            "id": r.id,
            "tg_user": r.tg_user,
            "start": r.start_at.isoformat(),
            "end": r.end_at.isoformat(),
        }
        for r in rows
    ]
    return JSONResponse(out)


@app.get("/api/admin/export_excel")
async def api_export_excel(request: Request):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "bookings"
    ws.append(["id", "tg_user", "start", "end", "created_at"])
    with get_session() as s:
        rows = s.exec(select(Booking).order_by(Booking.id)).scalars().all()
    for r in rows:
        ws.append([r.id, r.tg_user, r.start_at.isoformat(), r.end_at.isoformat(), r.created_at.isoformat()])
    fname = f"bookings_{int(datetime.now().timestamp())}.xlsx"
    fpath = BASE_DIR / "uploads" / fname
    fpath.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(fpath))
    bot_app = app.state.bot_app if hasattr(app.state, "bot_app") else None
    if bot_app:
        try:
            await bot_app.bot.send_document(chat_id=ADMIN_ID, document=open(str(fpath), "rb"))
        except Exception as e:
            # still return file
            pass
    return FileResponse(str(fpath), filename=fname, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/cancel_booking/{booking_id}")
def cancel_booking(booking_id: int, db: Session = Depends(get_session)):
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена")

    if booking.status != "active":
        raise HTTPException(status_code=400, detail="Бронь уже отменена или завершена")

    booking.status = "cancelled"
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return {"message": "Бронь успешно отменена", "booking_id": booking.id}


# Telegram bot
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    url = WEBAPP_URL or (await context.bot.get_me()).username
    if WEBAPP_URL:
        keyboard = [[InlineKeyboardButton("Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]]
        await update.message.reply_text("Открой мини-приложение:", reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.message.reply_text("WEBAPP_URL не задан на сервере")

async def run_bot():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN not set as env var")

    app_bot = ApplicationBuilder().token(BOT_TOKEN).build()
    app_bot.add_handler(CommandHandler("start", start_command))

    await app_bot.bot.delete_webhook(drop_pending_updates=True)
    await app_bot.run_polling()

    return app_bot

async def main():
    bot = await run_bot()
    app.state.bot_app = bot
    import uvicorn
    config = uvicorn.Config(app=app, host="0.0.0.0", port=8000, loop="asyncio", log_level="info")
    server = uvicorn.Server(config)
    try:
        await server.serve()
    finally:
        await bot.updater.stop()
        await bot.stop()
        await bot.shutdown()

if __name__ == "__main__":
    nest_asyncio.apply()
    asyncio.run(main())
