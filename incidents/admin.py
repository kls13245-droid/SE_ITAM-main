from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import Incident, IncidentLog, ReportBaseline, ReportSync


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


@admin.register(ReportSync)
class ReportSyncAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'created_by', 'item_name', 'doc_name', 'ok', 'created_blocks', 'deleted_blocks')
    readonly_fields = [f.name for f in ReportSync._meta.fields]
