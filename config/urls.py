from django.contrib import admin
from django.contrib.staticfiles.views import serve as static_serve
from django.urls import path, include, re_path
from django.views.generic import RedirectView  # <--- 이 줄이 빠져서 났던 에러입니다!

urlpatterns = [
    # 루트 주소로 오면 /admin/으로 자동 넘김
    path('', RedirectView.as_view(url='/admin/', permanent=True)),
    
    # 관리자 페이지 CSS·JS (settings.STATIC_URL 설명 참고). admin 주소보다 먼저 와야 한다
    re_path(r'^admin/static/(?P<path>.+)$', static_serve, {'insecure': True}),
    path('admin/', admin.site.urls),
    path('', include('assets.urls')),
    path('', include('reviews.urls')),
    path('', include('incidents.urls')),
]
