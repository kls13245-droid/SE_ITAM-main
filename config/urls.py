from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView  # <--- 이 줄이 빠져서 났던 에러입니다!

urlpatterns = [
    # 루트 주소로 오면 /admin/으로 자동 넘김
    path('', RedirectView.as_view(url='/admin/', permanent=True)),
    
    path('admin/', admin.site.urls),
    path('', include('assets.urls')),
    path('', include('reviews.urls')),
]
