from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import Incident, IncidentLog, ReportBaseline


class IncidentLogInline(admin.TabularInline):
    model = IncidentLog
    extra = 0
    fields = ('order', 'date', 'level', 'text')


@admin.register(Incident)
class IncidentAdmin(SimpleHistoryAdmin):
    list_display = ('title', 'kind', 'status', 'occurred_on', 'done_on', 'asset_name', 'hide_in_report')
    list_filter = ('kind', 'status', 'hide_in_report')
    search_fields = ('title', 'asset_name')
    inlines = [IncidentLogInline]


@admin.register(ReportBaseline)
class ReportBaselineAdmin(admin.ModelAdmin):
    list_display = ('year', 'kind', 'done_before', 'updated_at')

