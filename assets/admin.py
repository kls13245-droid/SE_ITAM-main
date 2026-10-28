from django.contrib import admin
from import_export.admin import ImportExportModelAdmin
from import_export import resources, fields
from import_export.widgets import ForeignKeyWidget
from .models import Campus, Building, Rack, ServerAsset

# --- 장고 관리자 화면 전역(Global) 설정 ---
admin.site.site_header = 'MIRERO ITAM 관리자 페이지'
admin.site.site_title = 'MIRERO ITAM 관리'
admin.site.index_title = '데이터센터 자산 관리'
admin.site.site_url = 'http://192.168.70.248:5173/' # 우측 상단 '사이트 보기' 링크를 리액트로 연결!

# 1. 엑셀 업로드/다운로드 시 사용할 자원(Resource) 설정
class ServerAssetResource(resources.ModelResource):
    # ⭐️ 핵심 추가: 엑셀의 rack 열에 적힌 '문자열(이름)'을 DB의 Rack 모델의 'name'과 자동 매칭합니다.
    rack = fields.Field(
        column_name='rack',
        attribute='rack',
        widget=ForeignKeyWidget(Rack, 'name')
    )

    class Meta:
        model = ServerAsset
        # 엑셀에서 ID 컬럼은 빼고 처리합니다.
        exclude = ('id',) 
        # 현재 models.py에 존재하는 필드만 정확히 매칭합니다.
        fields = (
            'hostname', 'model_name', 'rack', 'start_u', 'size_u', 
            'status', 'setup_year', 'description', 'os_version', 'specs'
        )
        # ⭐️ 핵심: id 대신 hostname을 기준으로 데이터를 식별하도록 설정
        import_id_fields = ('hostname',)

@admin.register(ServerAsset)
class ServerAssetAdmin(ImportExportModelAdmin):
    resource_class = ServerAssetResource
    
    # 목록 화면에 표시할 컬럼들 (현재 모델에 있는 항목만 띄웁니다)
    list_display = (
        'hostname', 'model_name', 'get_rack_name', 
        'status', 'os_version'
    )
    
    # 랙 이름을 예쁘게 보여주기 위한 함수
    def get_rack_name(self, obj):
        return obj.rack.name if obj.rack else "미실장"
    get_rack_name.short_description = 'Rack Name'

    # 우측 필터와 상단 검색창 설정
    list_filter = ('rack', 'status') 
    search_fields = ('hostname', 'model_name', 'os_version')

# 3. 나머지 모델들 등록
@admin.register(Campus)
class CampusAdmin(ImportExportModelAdmin):
    list_display = ('name',)

@admin.register(Building)
class BuildingAdmin(ImportExportModelAdmin):
    list_display = ('name', 'campus')

@admin.register(Rack)
class RackAdmin(ImportExportModelAdmin):
    # ⭐️ 수정: list_display 맨 앞에 'id'를 추가하여 화면에서 랙 고유번호를 바로 볼 수 있게 만듭니다.
    list_display = ('id', 'name', 'building', 'total_u_space', 'location')
    list_display_links = ('id', 'name') # ID 숫자를 클릭해도 상세 페이지로 들어가게끔 설정
