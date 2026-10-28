from rest_framework import serializers
from .models import Campus, Building, Rack, ServerAsset

class ServerAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServerAsset
        fields = '__all__'

class RackSerializer(serializers.ModelSerializer):
    servers = ServerAssetSerializer(many=True, read_only=True)
    
    class Meta:
        model = Rack
        fields = '__all__'

class BuildingSerializer(serializers.ModelSerializer):
    racks = RackSerializer(many=True, read_only=True)
    
    class Meta:
        model = Building
        fields = '__all__'

class CampusSerializer(serializers.ModelSerializer):
    buildings = BuildingSerializer(many=True, read_only=True)
    
    class Meta:
        model = Campus
        fields = '__all__'
