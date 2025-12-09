from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select
from sqlalchemy import BigInteger, Column

DB_HOST = "localhost"
DB_PORT = 5432
DB_USER = "postgres"
DB_PASS = "Oleg1101"
DB_NAME = "printerdb"

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    tg_id: int = Field(sa_column=Column(BigInteger, unique=True))
    username: Optional[str] = None
    first_name: Optional[str] = None
    avatar_url: Optional[str] = None
    nickname: Optional[str] = None


class ModelItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    filename: str
    image: Optional[str] = None
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

class PendingModel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    submitter_tg: Optional[int]
    title: str
    filename: str
    image: Optional[str]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    moderated: bool = False

class Booking(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    tg_user: int = Field(sa_column=Column(BigInteger))
    start_at: datetime
    end_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = Field(default="active")

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    return Session(engine)
