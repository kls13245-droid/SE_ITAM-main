from django.urls import path

from . import views

urlpatterns = [
    path('api/incidents/', views.incidents, name='incidents'),
    path('api/incidents/<int:incident_id>/', views.incident_detail, name='incident_detail'),
    path('api/incidents/<int:incident_id>/logs/', views.incident_logs, name='incident_logs'),
    path('api/incidents/<int:incident_id>/logs/reorder/', views.incident_logs_reorder, name='incident_logs_reorder'),
    path('api/incidents/logs/<int:log_id>/', views.incident_log_detail, name='incident_log_detail'),
    path('api/incidents/baseline/', views.baseline, name='incident_baseline'),
    path('api/incidents/report/text/', views.report_text, name='incident_report_text'),
    path('api/incidents/report/preview/', views.report_preview, name='incident_report_preview'),
    path('api/incidents/report/apply/', views.report_apply, name='incident_report_apply'),
    path('api/incidents/report/history/', views.report_history, name='incident_report_history'),
    path('api/incidents/import/preview/', views.import_preview, name='incident_import_preview'),
    path('api/incidents/import/apply/', views.import_apply, name='incident_import_apply'),
]
