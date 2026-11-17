from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import CpuSpec, MasterList, PartCode, PptTemplate, ReviewCase, ReviewOutput, SpecItem


@admin.register(PartCode)
class PartCodeAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'cis_code', 'key', 'updated_at')
    search_fields = ('name', 'cis_code', 'key')


@admin.register(MasterList)
class MasterListAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'group', 'source', 'updated_at')
    list_filter = ('group',)
    search_fields = ('name',)


@admin.register(CpuSpec)
class CpuSpecAdmin(SimpleHistoryAdmin):
    list_display = ('name', 'clock', 'cores')
    search_fields = ('name',)


class ReviewOutputInline(admin.TabularInline):
    model = ReviewOutput
    extra = 0
    fields = ('created_at', 'created_by', 'ok', 'pptx', 'xlsx')
    readonly_fields = fields


class SpecItemInline(admin.TabularInline):
    model = SpecItem
    extra = 0
    fields = ('order', 'block', 'kind', 'name', 'maker', 'model', 'qty', 'note')


@admin.register(ReviewCase)
class ReviewCaseAdmin(SimpleHistoryAdmin):
    list_display = ('title', 'line', 'product', 'year', 'status', 'input_mode', 'source_name', 'updated_at')
    list_filter = ('status', 'year', 'input_mode')
    search_fields = ('title', 'line', 'product')
    inlines = [SpecItemInline, ReviewOutputInline]


@admin.register(PptTemplate)
class PptTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'uploaded_by', 'uploaded_at')
