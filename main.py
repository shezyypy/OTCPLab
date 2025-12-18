import asyncio
from typing import Optional

import nest_asyncio
from datetime import timedelta, time as dtime, datetime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import aiofiles
import openpyxl
from sqlmodel import Session, select

from db import (
    create_db_and_tables,
    get_session,
    User,
    ModelItem,
    PendingModel,
    Booking, engine,
)

from octoprint import send_to_printer

BOT_TOKEN = "8397800534:AAEHn0aJwKQ_MmP4lKiAnzrzBQAq_t3GBQc"
WEBAPP_URL = "https://nonconflicting-overcaustically-zelda.ngrok-free.dev"
ADMIN_IDS = [1127824573]

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

def is_request_admin(request: Request):
    """
    Проверка администратора по заголовку X-TG-ID.
    Фронтенд должен передавать идентификатор пользователя Telegram (initDataUnsafe.user.id) в заголовке X-TG-ID.
    Если заголовок отсутствует или его значение не числовой идентификатор, функция возвращает False.
    Также возвращает False, если пользователь с таким ID не находится в списке ADMIN_IDS.
    Используется для защиты административных маршрутов.
    """
    try:
        if request is None:
            return False
        tg_id = request.headers.get("X-TG-ID")
        if not tg_id:
            return False
        return int(tg_id) in ADMIN_IDS
    except Exception:
        return False


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

@app.get("/library", response_class=HTMLResponse)
async def library():
    return (BASE_DIR / "webapp" / "library.html").read_text(encoding="utf-8")


@app.get("/api/models")
async def api_models():
    with get_session() as s:
        rows = s.exec(select(ModelItem).order_by(ModelItem.uploaded_at.desc())).all()
    out = [{"id": r.id, "title": r.title, "file": f"/storage/models/{r.filename}", "image": (f"/storage/images/{r.image}" if r.image else None)} for r in rows]
    return JSONResponse(out)

@app.post("/api/submit_model")
async def api_submit_model(
    title: str = Form(...),
    file: UploadFile = File(...),
    image: UploadFile = File(None),
    tg_user: int = Form(None)
):
    if not tg_user:
        raise HTTPException(status_code=400, detail="tg_user required")

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

    return JSONResponse(content={"success": True, "message": "Модель отправлена на модерацию", "pending_id": pm.id})


@app.post("/api/print/start")
async def start_print(booking_id: int, request: Request, session=Depends(get_session)):
    """
    Маршрут, имитирующий отправку модели в OctoPrint.
    Показывается кнопкой в личном кабинете.
    """
    user_id = int(request.headers.get("X-TG-ID"))

    booking = session.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена")

    if booking.user_id != user_id:
        raise HTTPException(status_code=403, detail="Это не ваша бронь")

    file_path = f"models/{booking_id}.gcode"
    result = await send_to_printer(file_path, user_id)

    return {
        "success": True,
        "message": "Модель отправлена на печать (симуляция)",
        "octoprint": result
    }


@app.post("/api/models/upload")
async def api_models_upload(
    title: str = Form(...),
    file: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
    tg_user: Optional[int] = Form(None),
):
    if not title.strip():
        raise HTTPException(status_code=422, detail="Поле 'title' обязательно")
    if not file.filename:
        raise HTTPException(status_code=422, detail="Файл модели обязателен")

    return await api_submit_model(title=title, file=file, image=image, tg_user=tg_user)

@app.get("/api/pending_models")
async def api_pending_models(request: Request):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    with get_session() as s:
        rows = s.exec(select(PendingModel).where(PendingModel.moderated == False).order_by(PendingModel.created_at.desc())).all()
    out = [{"id": r.id, "title": r.title, "file": f"/storage/pending/{r.filename}", "image": (f"/storage/images/{r.image}" if r.image else None), "submitter": r.submitter_tg} for r in rows]
    return JSONResponse(out)

@app.post("/api/admin/approve_model")
async def api_approve_model(payload: dict, request: Request):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

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
        lib = ModelItem(title=pm.title, filename=pm.filename, image=pm.image)
        s.add(lib)
        pm.moderated = True
        s.add(pm)
        s.commit()
        s.refresh(lib)
    return {"ok": True, "model_id": lib.id}

@app.post("/api/admin/reject_model")
async def api_reject_model(payload: dict, request: Request):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    pend_id = payload.get("pending_id")
    if pend_id is None:
        raise HTTPException(400, "pending_id required")
    with get_session() as s:
        pm = s.get(PendingModel, int(pend_id))
        if not pm:
            raise HTTPException(404, "Not found")
        pm.moderated = True
        s.add(pm)
        s.commit()
    return {"ok": True}

@app.get("/api/admin/bookings")
async def api_admin_bookings(request: Request):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    now = datetime.utcnow()

    with get_session() as s:
        rows = s.exec(
            select(Booking)
            .where(
                Booking.status == "active",
                Booking.end_at > now
            )
            .order_by(Booking.start_at)
        ).all()

    out = []
    for r in rows:
        out.append({
            "id": r.id,
            "tg_user": r.tg_user,
            "start": r.start_at.isoformat(),
            "end": r.end_at.isoformat(),
            "status": r.status
        })
    return out



@app.post("/api/book/cancel")
async def cancel_booking_client(data: dict, session: Session = Depends(get_session)):
    booking_id = data.get("booking_id")
    tg_user = data.get("tg_user")

    if not booking_id:
        return {"error": "Не указан ID бронирования"}

    booking = session.get(Booking, booking_id)
    if not booking:
        return {"error": "Бронирование не найдено"}

    if tg_user and booking.tg_user != int(tg_user):
        return {"error": "Вы не можете отменить чужое бронирование"}

    booking.status = "cancelled"
    session.add(booking)
    session.commit()
    session.refresh(booking)

    return {"ok": True, "message": "Бронирование успешно отменено"}

@app.get("/api/slots/{day}")
async def api_slots(day: str, s: Session = Depends(get_session)):
    from datetime import datetime, timedelta, time

    try:
        if day.isdigit():
            date_obj = (datetime.utcnow().date() + timedelta(days=int(day)))
        else:
            date_obj = datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    # Берём только активные бронирования
    bookings = s.exec(select(Booking).where(Booking.status == "active")).all()
    bookings_today = [b for b in bookings if b.start_at.date() == date_obj]

    now = datetime.utcnow()
    slots = []

    for hour in range(9, 21):
        start = datetime.combine(date_obj, time(hour=hour))
        end = datetime.combine(date_obj, time(hour=hour + 1))

        busy = any(b.start_at <= start < b.end_at for b in bookings_today)
        occupied = busy
        if date_obj == now.date() and start <= now:
            occupied = True

        slots.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "occupied": occupied
        })

    return JSONResponse(slots)


@app.post("/api/book")
async def create_booking(data: dict, session: Session = Depends(get_session)):
    tg_user = data.get("tg_user")
    username = data.get("username")
    first_name = data.get("first_name")
    nickname = data.get("nickname")
    printer_id = data.get("printer_id", 1)
    start = data.get("start") or data.get("start_time")
    end = data.get("end") or data.get("end_time")

    if not all([tg_user, start, end]):
        raise HTTPException(400, "Отсутствуют обязательные поля (tg_user, start, end)")

    try:
        tg_user = int(tg_user)
    except Exception:
        raise HTTPException(400, "tg_user должен быть числом")

    statement = select(User).where(User.tg_id == tg_user)
    user = session.exec(statement).first()

    if not user:
        # Создаем нового пользователя
        user = User(
            tg_id=tg_user,
            username=username or f"user_{tg_user}",
            first_name=first_name,
            nickname=nickname
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        # Обновляем пользователя, если есть новые данные и они отличаются
        updated = False
        if username and username != user.username:
            user.username = username
            updated = True
        if first_name and first_name != user.first_name:
            user.first_name = first_name
            updated = True
        if nickname and nickname != user.nickname:
            user.nickname = nickname
            updated = True
        if updated:
            session.add(user)
            session.commit()
            session.refresh(user)

    start_dt = datetime.fromisoformat(start)
    end_dt = datetime.fromisoformat(end)

    overlap = session.exec(
        select(Booking).where(
            Booking.start_at < end_dt,
            Booking.end_at > start_dt,
            Booking.status == "active"
        )
    ).first()
    if overlap:
        raise HTTPException(400, "Это время уже занято")

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

    print(f"NEW BOOKING: id={booking.id}, tg_user={booking.tg_user}, start={booking.start_at}")

    return {"ok": True, "booking_id": booking.id}


@app.get("/api/bookings")
async def api_bookings(all: bool = False, tg_user: int = None):
    from datetime import datetime
    def get_user_name(user, fallback_tg_id):
        if user:
            for name in (user.username, user.first_name, user.nickname):
                if name and name.strip():
                    return name
            return f"user_{fallback_tg_id}"
        return "неизвестно"
    if not tg_user:
        return JSONResponse([])

    with get_session() as s:
        q = select(Booking).where(Booking.tg_user == int(tg_user))
        if not all:
            q = q.where(
                Booking.status == "active",
                Booking.end_at > datetime.utcnow()
            )
        q = q.order_by(Booking.start_at)
        rows = s.exec(q).all()

        out = []
        for r in rows:
            user = s.get(User, r.user_id)
            print(f"Booking id={r.id}, user={user}")
            if user:
                print(f"User data: username={user.username}, first_name={user.first_name}, nickname={user.nickname}")
            else:
                print("User not found in DB")

            user_name = get_user_name(user, r.tg_user)
            out.append({
                "id": r.id,
                "tg_user": r.tg_user,
                "user_name": user_name,
                "start": r.start_at.isoformat(),
                "end": r.end_at.isoformat(),
                "title": getattr(r, "title", "Бронирование"),
                "status": r.status
            })

    return JSONResponse(out)



@app.get("/api/bookings/archive")
async def api_bookings_archive(all: bool = False, tg_user: int = None):
    from datetime import datetime
    now = datetime.utcnow()

    with get_session() as s:
        q = select(Booking).where(Booking.end_at < now)
        if not all and tg_user:
            q = q.where(Booking.tg_user == int(tg_user))
        q = q.order_by(Booking.start_at.desc())
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

@app.get("/api/bookings/by_date")
async def api_bookings_by_date(date: str, request: Request = None):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    from datetime import datetime, time

    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    start_dt = datetime.combine(day, time.min)
    end_dt = datetime.combine(day, time.max)

    with get_session() as s:
        q = select(Booking).where(Booking.start_at >= start_dt, Booking.start_at <= end_dt).order_by(Booking.start_at)
        rows = s.exec(q).all()

    out = [
        {
            "id": r.id,
            "tg_user": r.tg_user,
            "start": r.start_at.isoformat(),
            "end": r.end_at.isoformat(),
            "status": r.status
        }
        for r in rows
    ]
    return JSONResponse(out)

@app.post("/api/cancel_booking/{booking_id}")
def cancel_booking_admin(booking_id: int, request: Request, db: Session = Depends(get_session)):
    if not is_request_admin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

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

@app.get("/api/user_is_admin/{tg_id}")
async def api_user_is_admin(tg_id: int):
    return {"is_admin": tg_id in ADMIN_IDS}

# Telegram bot (unchanged)
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardMarkup, InlineKeyboardButton

bot: Bot = Bot(token=BOT_TOKEN)
dp: Dispatcher = Dispatcher()

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    if WEBAPP_URL:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]])
        await message.answer("Открой мини-приложение:", reply_markup=keyboard)
    else:
        await message.answer("WEBAPP_URL не задан на сервере")

async def run_bot():
    global bot, dp
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.message.register(cmd_start, Command("start"))
    await bot.delete_webhook(drop_pending_updates=True)
    asyncio.create_task(dp.start_polling(bot))
    return bot

async def main():
    bot_instance = await run_bot()
    app.state.bot_app = bot_instance
    import uvicorn
    config = uvicorn.Config(app=app, host="0.0.0.0", port=80, loop="asyncio", log_level="info")
    server = uvicorn.Server(config)
    try:
        await server.serve()
    finally:
        await dp.storage.close()
        await dp.storage.wait_closed()
        await bot_instance.session.close()

if __name__ == "__main__":
    nest_asyncio.apply()
    asyncio.run(main())
