"""
Mock Tests API routes
"""
import uuid
import random
from datetime import datetime
from flask import Blueprint, jsonify, request
from app.config import supabase
from app.middleware import auth_required, get_current_user_id

bp = Blueprint("mock_tests", __name__, url_prefix="/api/mock-tests")


@bp.route("", methods=["GET"])
@auth_required
def get_mock_tests():
    """Get user's mock tests history"""
    try:
        user_id = get_current_user_id()
        limit = int(request.args.get("limit", 20))
        offset = int(request.args.get("offset", 0))
        
        response = supabase.table("mock_tests").select(
            "*",
            count="exact"
        ).eq("user_id", user_id).order("created_at", desc=True).range(
            offset, offset + limit - 1
        ).execute()
        
        return jsonify({
            "success": True,
            "data": response.data,
            "count": response.count
        })
    except Exception as e:
        print(f"Error fetching mock tests: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch mock tests"
        }), 500


@bp.route("/<test_id>", methods=["GET"])
@auth_required
def get_mock_test(test_id):
    """Get a specific mock test with questions and answers"""
    try:
        user_id = get_current_user_id()
        
        # Get test info
        test_response = supabase.table("mock_tests").select(
            "*"
        ).eq("id", test_id).eq("user_id", user_id).single().execute()
        
        if not test_response.data:
            return jsonify({
                "success": False,
                "error": "Mock test not found"
            }), 404
        
        test = test_response.data
        
        # Get test answers with questions
        answers_response = supabase.table("mock_test_answers").select(
            "*, questions(*)"
        ).eq("mock_test_id", test_id).execute()
        
        test["answers"] = answers_response.data
        
        return jsonify({
            "success": True,
            "data": test
        })
    except Exception as e:
        print(f"Error fetching mock test: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch mock test"
        }), 500


@bp.route("/generate", methods=["POST"])
@auth_required
def generate_mock_test():
    """Generate a new mock test with random questions"""
    try:
        user_id = get_current_user_id()
        data = request.get_json()
        
        topic_ids = data.get("topic_ids", [])  # Empty = all topics
        question_count = int(data.get("question_count", 100))
        time_limit = int(data.get("time_limit", 180))  # Minutes
        
        # Fetch random questions
        query = supabase.table("questions").select("id, topic_id")
        
        if topic_ids:
            query = query.in_("topic_id", topic_ids)
        
        all_questions = query.execute().data
        
        if len(all_questions) < question_count:
            return jsonify({
                "success": False,
                "error": f"Not enough questions available. Found {len(all_questions)}, need {question_count}"
            }), 400
        
        # Random select questions
        selected = random.sample(all_questions, question_count)
        
        # Create mock test
        test_response = supabase.table("mock_tests").insert({
            "user_id": user_id,
            "total_questions": question_count,
            "time_limit": time_limit,
            "status": "not_started",
            "topic_ids": topic_ids if topic_ids else None
        }).execute()
        
        test = test_response.data[0]
        
        # Create answer slots
        answers_data = [
            {
                "mock_test_id": test["id"],
                "question_id": q["id"],
                "question_order": idx + 1
            }
            for idx, q in enumerate(selected)
        ]
        
        supabase.table("mock_test_answers").insert(answers_data).execute()
        
        return jsonify({
            "success": True,
            "data": test
        }), 201
        
    except Exception as e:
        print(f"Error generating mock test: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to generate mock test"
        }), 500


@bp.route("/<test_id>/start", methods=["POST"])
@auth_required
def start_mock_test(test_id):
    """Start a mock test"""
    try:
        user_id = get_current_user_id()
        
        # Check test exists and belongs to user
        test_response = supabase.table("mock_tests").select(
            "*"
        ).eq("id", test_id).eq("user_id", user_id).single().execute()
        
        if not test_response.data:
            return jsonify({
                "success": False,
                "error": "Mock test not found"
            }), 404
        
        test = test_response.data
        
        if test["status"] != "not_started":
            return jsonify({
                "success": False,
                "error": f"Cannot start test with status: {test['status']}"
            }), 400
        
        # Update test status
        updated = supabase.table("mock_tests").update({
            "status": "in_progress",
            "started_at": datetime.utcnow().isoformat()
        }).eq("id", test_id).execute()
        
        # Get questions for the test
        answers_response = supabase.table("mock_test_answers").select(
            "id, question_order, questions(*)"
        ).eq("mock_test_id", test_id).order("question_order").execute()
        
        return jsonify({
            "success": True,
            "data": {
                **updated.data[0],
                "questions": answers_response.data
            }
        })
    except Exception as e:
        print(f"Error starting mock test: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to start mock test"
        }), 500


@bp.route("/<test_id>/answer", methods=["POST"])
@auth_required
def submit_answer(test_id):
    """Submit an answer for a question in mock test"""
    try:
        user_id = get_current_user_id()
        data = request.get_json()
        
        question_id = data.get("question_id")
        selected_option = data.get("selected_option")
        
        if not question_id or selected_option is None:
            return jsonify({
                "success": False,
                "error": "Missing required fields"
            }), 400
        
        # Verify test belongs to user and is in progress
        test_response = supabase.table("mock_tests").select(
            "id, status"
        ).eq("id", test_id).eq("user_id", user_id).single().execute()
        
        if not test_response.data:
            return jsonify({
                "success": False,
                "error": "Mock test not found"
            }), 404
        
        if test_response.data["status"] != "in_progress":
            return jsonify({
                "success": False,
                "error": "Test is not in progress"
            }), 400
        
        # Get correct answer
        question = supabase.table("questions").select(
            "correct_option_index"
        ).eq("id", question_id).single().execute()
        
        is_correct = question.data["correct_option_index"] == selected_option
        
        # Update answer
        supabase.table("mock_test_answers").update({
            "selected_option": selected_option,
            "is_correct": is_correct,
            "answered_at": datetime.utcnow().isoformat()
        }).eq("mock_test_id", test_id).eq("question_id", question_id).execute()
        
        return jsonify({
            "success": True,
            "data": {
                "is_correct": is_correct
            }
        })
    except Exception as e:
        print(f"Error submitting answer: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to submit answer"
        }), 500


@bp.route("/<test_id>/submit", methods=["POST"])
@auth_required
def submit_mock_test(test_id):
    """Submit/complete the entire mock test"""
    try:
        user_id = get_current_user_id()
        
        # Verify test
        test_response = supabase.table("mock_tests").select(
            "*"
        ).eq("id", test_id).eq("user_id", user_id).single().execute()
        
        if not test_response.data:
            return jsonify({
                "success": False,
                "error": "Mock test not found"
            }), 404
        
        test = test_response.data
        
        if test["status"] != "in_progress":
            return jsonify({
                "success": False,
                "error": "Test is not in progress"
            }), 400
        
        # Calculate results
        answers = supabase.table("mock_test_answers").select(
            "is_correct, selected_option"
        ).eq("mock_test_id", test_id).execute()
        
        correct_count = sum(1 for a in answers.data if a.get("is_correct"))
        answered_count = sum(1 for a in answers.data if a.get("selected_option") is not None)
        total = len(answers.data)
        score = round((correct_count / total) * 100, 2) if total > 0 else 0
        
        # Calculate time taken
        started_at = datetime.fromisoformat(test["started_at"].replace("Z", "+00:00"))
        time_taken = int((datetime.utcnow().replace(tzinfo=started_at.tzinfo) - started_at).total_seconds() // 60)
        
        # Update test
        updated = supabase.table("mock_tests").update({
            "status": "completed",
            "completed_at": datetime.utcnow().isoformat(),
            "correct_answers": correct_count,
            "score": score,
            "time_taken": time_taken
        }).eq("id", test_id).execute()
        
        return jsonify({
            "success": True,
            "data": {
                **updated.data[0],
                "answered_count": answered_count,
                "correct_count": correct_count,
                "total_questions": total
            }
        })
    except Exception as e:
        print(f"Error submitting mock test: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to submit mock test"
        }), 500


@bp.route("/<test_id>", methods=["DELETE"])
@auth_required
def delete_mock_test(test_id):
    """Delete a mock test"""
    try:
        user_id = get_current_user_id()
        
        # Verify ownership
        test_response = supabase.table("mock_tests").select(
            "id"
        ).eq("id", test_id).eq("user_id", user_id).single().execute()
        
        if not test_response.data:
            return jsonify({
                "success": False,
                "error": "Mock test not found"
            }), 404
        
        # Delete answers first (due to FK)
        supabase.table("mock_test_answers").delete().eq(
            "mock_test_id", test_id
        ).execute()
        
        # Delete test
        supabase.table("mock_tests").delete().eq("id", test_id).execute()
        
        return jsonify({
            "success": True,
            "message": "Mock test deleted"
        })
    except Exception as e:
        print(f"Error deleting mock test: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to delete mock test"
        }), 500
