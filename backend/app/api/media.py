from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse


router = APIRouter()


@router.get("/api/media/{asset_id}")
def get_media(asset_id: str, request: Request):
    try:
        asset = request.app.state.asset_registry.get(asset_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Asset not found") from exc
    return FileResponse(
        asset.path,
        media_type=asset.mime_type,
        filename=asset.path.name,
    )
