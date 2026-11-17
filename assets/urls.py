from django.urls import path
from . import views

urlpatterns = [
    # ⭐️ 프론트엔드 로그인 인증 API
    path('api/csrf/', views.api_csrf, name='api_csrf'),
    path('api/login/', views.api_login, name='api_login'),
    path('api/logout/', views.api_logout, name='api_logout'),
    path('api/me/', views.api_me, name='api_me'),
    
    # 전체 사이트 데이터 로드
    path('api/site-data/', views.api_site_data, name='api_site_data'),
    
    # ⭐️ 토폴로지(캠퍼스/빌딩/랙) 추가 API 라우팅
    path('api/campus/add/', views.add_campus, name='add_campus'),
    path('api/campus/update/<int:campus_id>/', views.update_campus, name='update_campus'),
    path('api/campus/delete/<int:campus_id>/', views.delete_campus, name='delete_campus'),
    path('api/building/add/', views.add_building, name='add_building'),
    path('api/building/update/<int:building_id>/', views.update_building, name='update_building'),
    path('api/building/delete/<int:building_id>/', views.delete_building, name='delete_building'),
    path('api/rack/add/', views.add_rack, name='add_rack'),
    path('api/rack/update/<int:rack_id>/', views.update_rack, name='update_rack'),
    path('api/rack/delete/<int:rack_id>/', views.delete_rack, name='delete_rack'),
    path('api/server/import/', views.import_servers, name='import_servers'),
    path('api/server/import/template/', views.import_template, name='import_template'),
    
    # 서버 자산 추가 / 수정 / 삭제 API
    path('api/server/add/', views.add_server, name='add_server'),
    path('api/server/update/<int:server_id>/', views.update_server, name='update_server'),
    path('api/server/delete/<int:server_id>/', views.delete_server, name='delete_server'),
    
    # 현장 장비 (PM)
    path('api/field-assets/', views.field_assets, name='field_assets'),
    path('api/field-assets/import/', views.import_field_assets_view, name='import_field_assets'),
    path('api/field-assets/import/template/', views.field_assets_template, name='field_assets_template'),
    path('api/field-assets/add/', views.add_field_asset, name='add_field_asset'),
    path('api/field-assets/bulk/', views.bulk_update_field_assets, name='bulk_update_field_assets'),
    path('api/field-assets/place/', views.place_field_assets_view, name='place_field_assets'),
    path('api/field-assets/update/<int:asset_id>/', views.update_field_asset, name='update_field_asset'),
    path('api/field-assets/delete/<int:asset_id>/', views.delete_field_asset, name='delete_field_asset'),
    path('api/field-assets/<int:asset_id>/pm/', views.field_asset_pm_records, name='field_asset_pm_records'),
    path('api/field-assets/pm/delete/<int:record_id>/', views.delete_pm_record, name='delete_pm_record'),

    # 자산 변경 이력 조회 API
    path('api/server/history/<int:server_id>/', views.get_server_history, name='get_server_history'),
]
