import time
import uuid

import streamlit as st
from dotenv import dotenv_values
from streamlit_cookies_controller import CookieController
from utils import toast_for_rerun

class Authentificator:
    key_memory = {}
    last_attempt_time = 0

    @staticmethod
    def try_loggin():
        if "user_logged" in st.session_state and st.session_state["user_logged"]:
            return True

        if time.time() - Authentificator.last_attempt_time < 2:
            with st.spinner("Please wait 2 seconds between each login attempts."):
                while time.time() - Authentificator.last_attempt_time < 2:
                    time.sleep(0.1)

        config = dotenv_values("/.env")
        pwd = config.get("APP_PWD", "")

        if len(pwd) > 0:
            LOGIN_TIMEOUT = int(config["LOGIN_TIMEOUT"])
            # Cookie login
            controller = CookieController()
            auth_key = controller.get("auth_key")
            if auth_key is not None:
                Authentificator.last_attempt_time = time.time()
                if auth_key in Authentificator.key_memory:
                    if (
                        Authentificator.key_memory[auth_key]["last_used"]
                        + LOGIN_TIMEOUT
                        > time.time()
                    ):
                        Authentificator._log_user(controller, auth_key=auth_key)
                    else:
                        toast_for_rerun(
                            "Session expired, please log in again.", icon="⏳"
                        )
                        Authentificator._unlog_user(controller, auth_key)
                else:
                    toast_for_rerun("No valid session found.", icon="⚠️")
                    Authentificator._unlog_user(controller, auth_key)
            else:
                # Input login
                pwd_input = st.text_input("Password", type="password", key="app_pwd")
                if len(pwd_input) > 0:
                    Authentificator.last_attempt_time = time.time()

                if pwd_input == pwd:
                    Authentificator._log_user(controller)
                    st.rerun()

                # Error
                if len(pwd_input) > 0:
                    st.error("Invalid password!")
            return False
        else:
            st.session_state["user_logged"] = True
            return True

    @staticmethod
    def _log_user(controller: CookieController, auth_key=None):
        if auth_key is None:
            auth_key = str(uuid.uuid4())
        if auth_key not in Authentificator.key_memory:
            Authentificator.key_memory[auth_key] = {
                "created": time.time(),
                "last_used": time.time(),
            }
        controller.set(
            "auth_key",
            auth_key,
            path="/",
        )
        st.session_state["user_logged"] = True
        time.sleep(0.1)
        toast_for_rerun("Welcome back!", icon="👋")
        st.rerun()

    @staticmethod
    def _unlog_user(controller: CookieController, uuid: str = None):
        controller.remove("auth_key")
        if "user_logged" in st.session_state:
            del st.session_state["user_logged"]
        if uuid and uuid in Authentificator.key_memory:
            del Authentificator.key_memory[uuid]
        time.sleep(0.1)
        st.rerun()
