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
]
