"""
Bookmarks API routes
"""
from flask import Blueprint, jsonify, request
from app.config import supabase
from app.middleware import auth_required, get_current_user_id

bp = Blueprint("bookmarks", __name__, url_prefix="/api/bookmarks")


@bp.route("", methods=["GET"])
@auth_required
def get_bookmarks():
    """Get user's bookmarked questions"""
    try:
        user_id = get_current_user_id()
        topic_id = request.args.get("topic_id")
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
        
        query = supabase.table("bookmarks").select(
            "*, questions(*), topics(id, name, short_name)",
            count="exact"
        ).eq("user_id", user_id).order("created_at", desc=True)
        
        if topic_id:
            query = query.eq("topic_id", topic_id)
        
        response = query.range(offset, offset + limit - 1).execute()
        
        return jsonify({
            "success": True,
            "data": response.data,
            "count": response.count
        })
    except Exception as e:
        print(f"Error fetching bookmarks: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch bookmarks"
        }), 500


@bp.route("", methods=["POST"])
@auth_required
def add_bookmark():
    """Add a question to bookmarks"""
    try:
        user_id = get_current_user_id()
        data = request.get_json()
        
        question_id = data.get("question_id")
        topic_id = data.get("topic_id")
        notes = data.get("notes", "")
        
        if not question_id or not topic_id:
            return jsonify({
                "success": False,
                "error": "Missing required fields: question_id, topic_id"
            }), 400
        
        response = supabase.table("bookmarks").insert({
            "user_id": user_id,
            "question_id": question_id,
            "topic_id": topic_id,
            "notes": notes
        }).execute()
        
        return jsonify({
            "success": True,
            "data": response.data[0] if response.data else None
        }), 201
        
    except Exception as e:
        error_msg = str(e)
        if "duplicate" in error_msg.lower() or "23505" in error_msg:
            return jsonify({
                "success": False,
                "error": "Already bookmarked"
            }), 409
        
        print(f"Error adding bookmark: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to add bookmark"
        }), 500


@bp.route("/<question_id>", methods=["DELETE"])
@auth_required
def remove_bookmark(question_id):
    """Remove a question from bookmarks"""
    try:
        user_id = get_current_user_id()
        
        supabase.table("bookmarks").delete().eq(
            "user_id", user_id
        ).eq("question_id", question_id).execute()
        
        return jsonify({
            "success": True,
            "message": "Bookmark removed"
        })
    except Exception as e:
        print(f"Error removing bookmark: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to remove bookmark"
        }), 500


@bp.route("/check/<question_id>", methods=["GET"])
@auth_required
def check_bookmark(question_id):
    """Check if a question is bookmarked"""
    try:
        user_id = get_current_user_id()
        
        response = supabase.table("bookmarks").select(
            "id"
        ).eq("user_id", user_id).eq("question_id", question_id).execute()
        
        return jsonify({
            "success": True,
            "is_bookmarked": len(response.data) > 0
        })
    except Exception as e:
        print(f"Error checking bookmark: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to check bookmark"
        }), 500
