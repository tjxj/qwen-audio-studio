from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse


router = APIRouter()


@router.get("/api/media/{asset_id}")
def get_media(asset_id: str, request: Request, download: bool = False):
    """Serve registered assets only; a missing file is 410, not a 404 guess."""
    try:
        asset = request.app.state.studio.resolve_asset(asset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Asset not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="音频文件已移动或缺失") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Asset not found") from exc
    return FileResponse(
        asset["path"],
        media_type=asset["mime_type"],
        filename=asset["path"].name if download else None,
    )
