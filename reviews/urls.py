from django.urls import path

from . import views

urlpatterns = [
    path('api/reviews/', views.cases, name='review_cases'),
    path('api/reviews/<int:case_id>/', views.case_detail, name='review_case_detail'),
    path('api/reviews/<int:case_id>/upload/', views.case_upload, name='review_case_upload'),
    path('api/reviews/<int:case_id>/source/', views.case_source, name='review_case_source'),
    path('api/reviews/<int:case_id>/generate/', views.case_generate, name='review_case_generate'),
    path('api/reviews/outputs/<int:output_id>/<str:kind>/', views.output_file, name='review_output_file'),
    path('api/reviews/template/', views.template, name='review_template'),
    path('api/reviews/template/file/', views.template_file, name='review_template_file'),
    path('api/reviews/master/', views.master, name='review_master'),
    path('api/reviews/master/import/', views.master_import, name='review_master_import'),
    path('api/reviews/master/codes/<int:code_id>/', views.part_code_update, name='review_part_code_update'),
]
