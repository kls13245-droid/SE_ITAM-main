from django.urls import path
from . import views

urlpatterns = [
    # ⭐️ 프론트엔드 로그인 인증 API
    path('api/login/', views.api_login, name='api_login'),
    
    # 전체 사이트 데이터 로드
    path('api/site-data/', views.api_site_data, name='api_site_data'),
    
    # ⭐️ 토폴로지(캠퍼스/빌딩/랙) 추가 API 라우팅
    path('api/campus/add/', views.add_campus, name='add_campus'),
    path('api/building/add/', views.add_building, name='add_building'),
    path('api/rack/add/', views.add_rack, name='add_rack'),
    
    # 서버 자산 추가 / 수정 / 삭제 API
    path('api/server/add/', views.add_server, name='add_server'),
    path('api/server/update/<int:server_id>/', views.update_server, name='update_server'),
    path('api/server/delete/<int:server_id>/', views.delete_server, name='delete_server'),
    
    # 자산 변경 이력 조회 API
    path('api/server/history/<int:server_id>/', views.get_server_history, name='get_server_history'),
]
