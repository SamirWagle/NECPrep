"""
Topics API routes
"""
from flask import Blueprint, jsonify
from app.config import supabase

bp = Blueprint("topics", __name__, url_prefix="/api/topics")


@bp.route("", methods=["GET"])
def get_topics():
    """Get all topics ordered by display_order"""
    try:
        response = supabase.table("topics").select("*").order("display_order").execute()
        
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        print(f"Error fetching topics: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch topics"
        }), 500


@bp.route("/<topic_id>", methods=["GET"])
def get_topic(topic_id):
    """Get a single topic by ID"""
    try:
        response = supabase.table("topics").select("*").eq("id", topic_id).single().execute()
        
        if not response.data:
            return jsonify({
                "success": False,
                "error": "Topic not found"
            }), 404
        
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        print(f"Error fetching topic: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch topic"
        }), 500
