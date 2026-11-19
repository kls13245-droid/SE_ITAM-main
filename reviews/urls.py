from django.urls import path

from . import views

urlpatterns = [
    path('api/reviews/', views.cases, name='review_cases'),
    path('api/reviews/<int:case_id>/', views.case_detail, name='review_case_detail'),
    path('api/reviews/<int:case_id>/upload/', views.case_upload, name='review_case_upload'),
    path('api/reviews/<int:case_id>/source/', views.case_source, name='review_case_source'),
    path('api/reviews/<int:case_id>/items/', views.case_items_view, name='review_case_items'),
    path('api/reviews/<int:case_id>/items/calc/', views.case_items_calc, name='review_case_items_calc'),
    path('api/reviews/<int:case_id>/items/import/', views.case_items_import, name='review_case_items_import'),
    path('api/reviews/<int:case_id>/items/excel/', views.case_items_excel, name='review_case_items_excel'),
    path('api/reviews/<int:case_id>/generate/', views.case_generate, name='review_case_generate'),
    path('api/reviews/outputs/<int:output_id>/<str:kind>/', views.output_file, name='review_output_file'),
    path('api/reviews/template/', views.template, name='review_template'),
    path('api/reviews/template/file/', views.template_file, name='review_template_file'),
    path('api/reviews/master/', views.master, name='review_master'),
    path('api/reviews/master/lists/add/', views.master_list_add, name='review_master_list_add'),
    path('api/reviews/master/check/', views.master_check_view, name='review_master_check'),
    path('api/reviews/master/check/fix/', views.master_check_fix, name='review_master_check_fix'),
    path('api/reviews/master/import/', views.master_import, name='review_master_import'),
    path('api/reviews/master/history/', views.master_history, name='review_master_history'),
    path('api/reviews/master/lists/', views.master_lists, name='review_master_lists'),
    path('api/reviews/master/lists/<int:list_id>/', views.master_list_detail, name='review_master_list_detail'),
    path('api/reviews/master/cpus/', views.master_cpus, name='review_master_cpus'),
    path('api/reviews/master/cpus/<int:cpu_id>/', views.master_cpu_detail, name='review_master_cpu_detail'),
    path('api/reviews/master/codes/', views.part_codes, name='review_part_codes'),
    path('api/reviews/master/codes/<int:code_id>/', views.part_code_update, name='review_part_code_update'),
]
