"""
Questions API routes
"""
import random
from flask import Blueprint, jsonify, request
from app.config import supabase
from app.middleware import auth_required

bp = Blueprint("questions", __name__, url_prefix="/api/questions")


@bp.route("", methods=["GET"])
@auth_required
def get_questions():
    """
    Get questions with optional filters.
    Query params: topic_id, limit, offset, difficulty, random
    """
    try:
        topic_id = request.args.get("topic_id")
        limit = int(request.args.get("limit", 20))
        offset = int(request.args.get("offset", 0))
        difficulty = request.args.get("difficulty")
        is_random = request.args.get("random", "false").lower() == "true"
        
        query = supabase.table("questions").select("*", count="exact")
        
        if topic_id:
            query = query.eq("topic_id", topic_id)
        
        if difficulty:
            query = query.eq("difficulty", difficulty)
        
        if is_random:
            # Fetch all matching questions and shuffle
            response = query.execute()
            questions = response.data or []
            random.shuffle(questions)
            questions = questions[:limit]
            
            return jsonify({
                "success": True,
                "data": questions,
                "count": response.count
            })
        else:
            response = query.range(offset, offset + limit - 1).execute()
            
            return jsonify({
                "success": True,
                "data": response.data,
                "count": response.count,
                "offset": offset,
                "limit": limit
            })
            
    except Exception as e:
        print(f"Error fetching questions: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch questions"
        }), 500


@bp.route("/<question_id>", methods=["GET"])
@auth_required
def get_question(question_id):
    """Get a single question by ID"""
    try:
        response = supabase.table("questions").select(
            "*, topics(name, short_name)"
        ).eq("id", question_id).single().execute()
        
        if not response.data:
            return jsonify({
                "success": False,
                "error": "Question not found"
            }), 404
        
        return jsonify({
            "success": True,
            "data": response.data
        })
    except Exception as e:
        print(f"Error fetching question: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch question"
        }), 500


@bp.route("/topic/<topic_id>", methods=["GET"])
@auth_required
def get_questions_by_topic(topic_id):
    """Get questions for a specific topic"""
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
        
        response = supabase.table("questions").select(
            "*", count="exact"
        ).eq("topic_id", topic_id).range(offset, offset + limit - 1).execute()
        
        return jsonify({
            "success": True,
            "data": response.data,
            "count": response.count,
            "topic_id": topic_id,
            "offset": offset,
            "limit": limit
        })
    except Exception as e:
        print(f"Error fetching questions by topic: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch questions"
        }), 500
