from fastapi import APIRouter, Request


router = APIRouter()


@router.get("/api/capabilities")
def get_capabilities(request: Request):
    return request.app.state.qwen_adapter.capabilities()
