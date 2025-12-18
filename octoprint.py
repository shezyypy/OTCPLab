import logging
import asyncio
from datetime import datetime

logger = logging.getLogger("FakeOctoPrint")
logger.setLevel(logging.INFO)

async def send_to_printer(file_path: str, user_id: int):
    logger.info(f"[OCTOPRINT] Пользователь {user_id} отправил модель '{file_path}' на печать.")
    await asyncio.sleep(1)
    logger.info(f"[OCTOPRINT] Печать модели '{file_path}' успешно (фиктивно) началась!")

    return {
        "success": True,
        "file": file_path,
        "timestamp": datetime.now().isoformat()
    }
