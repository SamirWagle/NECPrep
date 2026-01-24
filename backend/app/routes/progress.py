"""
User Progress API routes
"""
from datetime import datetime
from flask import Blueprint, jsonify, request
from app.config import supabase
from app.middleware import auth_required, get_current_user_id

bp = Blueprint("progress", __name__, url_prefix="/api/progress")


@bp.route("", methods=["GET"])
@auth_required
def get_progress():
    """Get user's overall progress including topic-wise breakdown"""
    try:
        user_id = get_current_user_id()
        
        # Get overall stats from view
        overall_response = supabase.table("user_overall_stats").select(
            "*"
        ).eq("user_id", user_id).execute()
        
        # Get topic-wise progress from view
        topics_response = supabase.table("user_topic_stats").select(
            "*"
        ).eq("user_id", user_id).execute()
        
        overall = overall_response.data[0] if overall_response.data else {
            "streak_days": 0,
            "rank": "Beginner",
            "total_questions_answered": 0,
            "total_correct_answers": 0,
            "total_study_minutes": 0,
            "active_days": 0,
            "mock_tests_passed": 0
        }
        
        return jsonify({
            "success": True,
            "data": {
                "overall": overall,
                "topics": topics_response.data or []
            }
        })
    except Exception as e:
        print(f"Error fetching progress: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch progress"
        }), 500


@bp.route("/question", methods=["POST"])
@auth_required
def record_question_attempt():
    """Record a question attempt (answer submission)"""
    try:
        user_id = get_current_user_id()
        data = request.get_json()
        
        question_id = data.get("question_id")
        topic_id = data.get("topic_id")
        is_correct = data.get("is_correct")
        
        if not question_id or not topic_id or is_correct is None:
            return jsonify({
                "success": False,
                "error": "Missing required fields: question_id, topic_id, is_correct"
            }), 400
        
        # Upsert progress record
        response = supabase.table("user_question_progress").upsert({
            "user_id": user_id,
            "question_id": question_id,
            "topic_id": topic_id,
            "is_correct": is_correct,
            "last_attempted_at": datetime.utcnow().isoformat()
        }, on_conflict="user_id,question_id").execute()
        
        return jsonify({
            "success": True,
            "data": response.data[0] if response.data else None
        })
    except Exception as e:
        print(f"Error recording progress: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to record progress"
        }), 500


@bp.route("/topic/<topic_id>", methods=["GET"])
@auth_required
def get_topic_progress(topic_id):
    """Get progress for a specific topic"""
    try:
        user_id = get_current_user_id()
        
        response = supabase.table("user_topic_stats").select(
            "*"
        ).eq("user_id", user_id).eq("topic_id", topic_id).execute()
        
        if response.data:
            return jsonify({
                "success": True,
                "data": response.data[0]
            })
        else:
            return jsonify({
                "success": True,
                "data": {
                    "topic_id": topic_id,
                    "questions_attempted": 0,
                    "questions_correct": 0,
                    "progress_percent": 0
                }
            })
    except Exception as e:
        print(f"Error fetching topic progress: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch topic progress"
        }), 500


@bp.route("/questions/<topic_id>", methods=["GET"])
@auth_required
def get_answered_questions(topic_id):
    """Get list of questions user has answered in a topic"""
    try:
        user_id = get_current_user_id()
        
        response = supabase.table("user_question_progress").select(
            "question_id, is_correct, attempts, last_attempted_at"
        ).eq("user_id", user_id).eq("topic_id", topic_id).execute()
        
        return jsonify({
            "success": True,
            "data": response.data or []
        })
    except Exception as e:
        print(f"Error fetching answered questions: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch answered questions"
        }), 500
