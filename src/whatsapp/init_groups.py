from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import insert
from sqlmodel.ext.asyncio.session import AsyncSession

from models import Group, BaseGroup, Sender, BaseSender, upsert
from .gateway import WhatsAppGateway

# Columns the WhatsApp gateway owns. Everything else on `group` (settings,
# display_name, bot timestamps) belongs to the admin / bot and is never
# overwritten by the sync.
SYNC_OWNED_COLUMNS = ("group_name", "group_topic", "owner_jid")


async def gather_groups(session: AsyncSession, client: WhatsAppGateway) -> None:
    for g in await client.list_groups():
        owner_usr = g.owner_jid or None
        if owner_usr and (await session.get(Sender, owner_usr)) is None:
            owner = Sender(**BaseSender(jid=owner_usr).model_dump())
            await upsert(session, owner)

        group = Group(
            **BaseGroup(
                group_jid=g.jid,
                group_name=g.name,
                group_topic=g.topic,
                owner_jid=owner_usr,
            ).model_dump()
        )
        stmt = insert(Group).values(
            **{c.name: getattr(group, c.name) for c in inspect(Group).columns}
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["group_jid"],
            set_={col: stmt.excluded[col] for col in SYNC_OWNED_COLUMNS},
        )
        await session.execute(stmt)
