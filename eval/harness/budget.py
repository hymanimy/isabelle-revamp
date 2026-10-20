"""Persistent, process-safe reservations; interrupted calls keep their reservation."""
from __future__ import annotations

from pathlib import Path
import sqlite3
import time


class BudgetStop(Exception):
    pass


class Budget:
    def __init__(self, path: Path, max_usd: float, max_hours: float):
        self.path, self.max_usd, self.max_hours = path, max_usd, max_hours
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS clock (started REAL)")
            db.execute("INSERT INTO clock SELECT ? WHERE NOT EXISTS (SELECT 1 FROM clock)", (time.time(),))
            db.execute("CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, usd REAL, settled INTEGER)")

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30)

    def remaining_s(self) -> float:
        with self.connect() as db:
            start = db.execute("SELECT started FROM clock").fetchone()[0]
        return max(0., self.max_hours * 3600 - (time.time() - start))

    def reserve(self, identity: str, upper_bound: float) -> None:
        if self.remaining_s() <= 0:
            raise BudgetStop("wall-clock limit reached")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM calls WHERE id=?", (identity,)).fetchone():
                raise BudgetStop("request already reserved; refusing an ambiguous repeat")
            total = db.execute("SELECT COALESCE(SUM(usd),0) FROM calls").fetchone()[0]
            if total + upper_bound > self.max_usd + 1e-12:
                raise BudgetStop("LLM budget cannot cover the next bounded request")
            db.execute("INSERT INTO calls VALUES (?,?,0)", (identity, upper_bound))

    def settle(self, identity: str, actual: float) -> None:
        with self.connect() as db:
            updated = db.execute("UPDATE calls SET usd=?, settled=1 WHERE id=?", (actual, identity))
            if updated.rowcount != 1:
                raise BudgetStop("missing reservation; refusing to lose historical spend")

    def total(self) -> float:
        with self.connect() as db:
            return db.execute("SELECT COALESCE(SUM(usd),0) FROM calls").fetchone()[0]
