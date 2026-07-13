import json
import logging
from datetime import datetime

import numpy as np

from controllers.SummarizeManager import SummarizeManager
from db import Embedding, get_db


class EmbeddingManager:
    _model = None

    @classmethod
    def _get_model(cls):
        if cls._model is None:
            logging.info("EmbeddingManager >> Loading model (all-MiniLM-L6-v2)...")
            from sentence_transformers import SentenceTransformer
            cls._model = SentenceTransformer("all-MiniLM-L6-v2")
            logging.info("EmbeddingManager >> Model ready.")
        return cls._model

    @classmethod
    def _text_for_file(cls, file):
        meta = SummarizeManager.get(file)
        if not meta:
            return None
        return " ".join([
            " ".join(meta.get("keywords", [])),
            meta.get("summary", ""),
        ]).strip() or None

    @classmethod
    def get(cls, file):
        db = get_db()
        row = db.query(Embedding).filter(Embedding.file == file).first()
        db.close()
        if not row:
            return None
        return np.array(json.loads(row.vector), dtype=np.float32)

    @classmethod
    def _save(cls, db, file, vector):
        row = db.query(Embedding).filter(Embedding.file == file).first()
        if row:
            row.vector = json.dumps(vector.tolist())
            row.date = datetime.now()
        else:
            db.add(Embedding(file=file, date=datetime.now(), vector=json.dumps(vector.tolist())))

    @classmethod
    def generate(cls, file):
        text = cls._text_for_file(file)
        if not text:
            return None
        vector = cls._get_model().encode(text, normalize_embeddings=True)
        db = get_db()
        try:
            cls._save(db, file, vector)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"EmbeddingManager >> Error saving embedding for {file}: {e}")
        finally:
            db.close()
        return vector

    @classmethod
    def get_or_generate(cls, file):
        v = cls.get(file)
        return v if v is not None else cls.generate(file)

    @classmethod
    def batch_generate(cls, files):
        """Encode multiple files in one model pass (much faster than one by one)."""
        model = cls._get_model()
        texts, valid = [], []
        for file in files:
            t = cls._text_for_file(file)
            if t:
                texts.append(t)
                valid.append(file)
        if not texts:
            return
        vectors = model.encode(texts, normalize_embeddings=True, batch_size=32)
        db = get_db()
        try:
            for file, vector in zip(valid, vectors):
                cls._save(db, file, vector)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"EmbeddingManager >> Error batch saving: {e}")
        finally:
            db.close()

    @classmethod
    def encode_query(cls, text):
        return cls._get_model().encode(text, normalize_embeddings=True)

    @classmethod
    def search(cls, query_vector, top_k=5, min_similarity=0.4, exclude_files=None, include_files=None):
        """Vectorized cosine-similarity top-k search over stored embeddings.
        If include_files is given, only those files are considered (used to scope search to an
        already-filtered candidate set). Returns a list of (file, score) tuples, most similar first."""
        exclude = set(exclude_files or [])
        allow = set(include_files) if include_files is not None else None
        db = get_db()
        try:
            rows = db.query(Embedding).all()
            files, vectors = [], []
            for row in rows:
                if row.file in exclude:
                    continue
                if allow is not None and row.file not in allow:
                    continue
                files.append(row.file)
                vectors.append(json.loads(row.vector))
        finally:
            db.close()

        if not files:
            return []

        matrix = np.array(vectors, dtype=np.float32)
        scores = matrix @ np.asarray(query_vector, dtype=np.float32)

        ranked = sorted(zip(files, scores.tolist()), key=lambda pair: pair[1], reverse=True)
        return [(file, score) for file, score in ranked if score >= min_similarity][:top_k]

    @classmethod
    def delete(cls, file):
        db = get_db()
        try:
            row = db.query(Embedding).filter(Embedding.file == file).first()
            if row:
                db.delete(row)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"EmbeddingManager >> Error deleting for {file}: {e}")
        finally:
            db.close()

    @classmethod
    def move(cls, file, new_file):
        db = get_db()
        try:
            row = db.query(Embedding).filter(Embedding.file == file).first()
            if row:
                row.file = new_file
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"EmbeddingManager >> Error moving {file} -> {new_file}: {e}")
        finally:
            db.close()
