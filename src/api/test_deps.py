from api.deps import first_openwa_session_id
from models import OpenWASession


async def test_first_openwa_session_id_is_none_without_sessions(db_sessionmaker):
    async with db_sessionmaker() as session:
        assert await first_openwa_session_id(session) is None


async def test_first_openwa_session_id_returns_lowest_id(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(OpenWASession(id="b", label="B", openwa_session_id="wa-b"))
        session.add(OpenWASession(id="a", label="A", openwa_session_id="wa-a"))
        await session.commit()
        assert await first_openwa_session_id(session) == "a"
