from fastapi import APIRouter, Request

router = APIRouter()

@router.get('/api/directories/default')
def default_directory(request: Request):
    return request.app.state.directories.public()

@router.post('/api/directories/choose')
def choose(request: Request):
    return request.app.state.directories.choose()

@router.get('/api/directories/{directory_id}')
def get_directory(directory_id:str,request:Request):
    return request.app.state.directories.public(directory_id)

@router.post('/api/directories/{directory_id}/validate')
def validate(directory_id: str, request: Request):
    return request.app.state.directories.validate(directory_id)

@router.post('/api/directories/{directory_id}/reveal', status_code=204)
def reveal(directory_id: str, request: Request):
    request.app.state.directories.reveal(directory_id)

@router.post('/api/assets/{asset_id}/reveal', status_code=204)
def reveal_asset(asset_id: str, request: Request):
    request.app.state.directories.reveal_asset(asset_id)
