import logging
import time

from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


class DB:
    __instance = None

    @staticmethod
    def __new__(cls, *args, **kwargs):
        if DB.__instance is None:
            DB.__instance = super(DB, cls).__new__(cls, *args, **kwargs)
            config = dotenv_values("/.env")

            while True:
                try:
                    DB.__instance.engine = create_engine(
                        f"mysql+mysqldb://root:{config['DATABASE_PASSWORD']}@back_db:3306/superdiary",
                        pool_recycle=3600,
                        pool_pre_ping=True,
                    )
                    # Try to connect to the database to ensure it's ready
                    DB.__instance.engine.connect()
                    break
                except Exception as e:
                    logging.error(
                        f"Database connection failed: {e}. Retrying in 5 seconds..."
                    )
                    time.sleep(5)
        return DB.__instance

    def get(self):
        Session = sessionmaker(bind=self.engine)()
        return Session


def get_db():
    return DB().get()


