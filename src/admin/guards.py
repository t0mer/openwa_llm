from fastapi import HTTPException, Request


def reject_nul_chars(request: Request) -> None:
    """Postgres text cannot hold NUL; reject it in query/path input with 422."""
    values = [
        *(part for pair in request.query_params.multi_items() for part in pair),
        *request.path_params.values(),
    ]
    if any("\x00" in str(v) for v in values):
        raise HTTPException(status_code=422, detail="NUL characters are not allowed")
