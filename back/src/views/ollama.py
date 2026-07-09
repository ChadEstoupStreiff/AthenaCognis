import logging

import requests
from controllers.SummarizeManager import SummarizeManager
from fastapi import APIRouter, HTTPException
from views.settings import get_setting

router = APIRouter(prefix="/ollama", tags=["Ollama"])


@router.get("/summary/{model}")
async def make_summary(content: str, model: str):
    try:
        return SummarizeManager.make_summary(
            input=content,
        )
    except Exception as e:
        logging.error(f"Error making summary with model {model}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error making summary with model {model}: {str(e)}"
        )


def list_models():
    server_url = get_setting("ollama_server", "http://ollama:11434")
    response = requests.get(f"{server_url}/api/tags")
    if response.status_code == 200:
        return response.json()["models"]
    else:
        raise Exception(
            f"Failed to fetch models: {response.status_code} {response.text}"
        )


@router.get("/list")
async def request_list_models():
    return list_models()

@router.get("/test_url")
async def test_url():
    server_url = get_setting("ollama_server", "http://ollama:11434")
    response = requests.get(f"{server_url}")
    if response.status_code == 200:
        if response.text == "Ollama is running":
            return True
        else:
            raise HTTPException(
                status_code=500, detail="Ollama server is not responding as expected."
            )
    else:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Ollama server: {response.status_code} {response.text}",
        )


def pull_model(model_name):
    logging.info(f"Pulling model: {model_name}")
    server_url = get_setting("ollama_server", "http://ollama:11434")
    response = requests.post(f"{server_url}/api/pull", json={"name": model_name})
    if response.status_code == 200:
        return response.content
    else:
        raise Exception(
            f"Failed to pull model '{model_name}': {response.status_code} {response.text}"
        )


@router.post("/pull/{model_name}")
async def request_pull_model(model_name: str):
    return pull_model(model_name)


@router.delete("/delete/{model_name}")
async def delete_model(model_name):
    logging.info(f"Deleting model: {model_name}")
    server_url = get_setting("ollama_server", "http://ollama:11434")
    response = requests.delete(
        f"{server_url}/api/delete", json={"name": model_name}
    )
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(
            f"Failed to delete model '{model_name}': {response.status_code} {response.text}"
        )
