FROM python:3.12-slim-bookworm

RUN apt-get update -y
RUN apt-get upgrade -y
RUN pip install --upgrade pip setuptools wheel
RUN apt-get install fonts-dejavu-core -y

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt

COPY config.toml config.toml
RUN mkdir -p ~/.streamlit
RUN cp config.toml ~/.streamlit/config.toml

COPY assets /assets
COPY src /app
WORKDIR /app

EXPOSE 80
ENTRYPOINT ["streamlit", "run"]
CMD ["main.py"]
