"""
Authentication middleware for JWT token verification
"""
from functools import wraps
from flask import request, jsonify, g
from app.config import supabase


def auth_required(f):
    """
    Decorator to protect routes that require authentication.
    Extracts and verifies JWT token from Authorization header.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        
        if not auth_header:
            return jsonify({
                "success": False,
                "error": "Missing authorization header"
            }), 401
        
        # Extract token from "Bearer <token>"
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return jsonify({
                "success": False,
                "error": "Invalid authorization header format"
            }), 401
        
        token = parts[1]
        
        try:
            # Verify token with Supabase
            user_response = supabase.auth.get_user(token)
            
            if not user_response or not user_response.user:
                return jsonify({
                    "success": False,
                    "error": "Invalid or expired token"
                }), 401
            
            # Store user info in Flask's g object for use in route handlers
            g.user = {
                "id": user_response.user.id,
                "email": user_response.user.email,
                "role": user_response.user.role or "authenticated"
            }
            g.token = token
            
        except Exception as e:
            print(f"Auth error: {e}")
            return jsonify({
                "success": False,
                "error": "Authentication failed"
            }), 401
        
        return f(*args, **kwargs)
    
    return decorated_function


def get_current_user():
    """Get the current authenticated user from Flask's g object"""
    return getattr(g, "user", None)


def get_current_user_id():
    """Get the current authenticated user's ID"""
    user = get_current_user()
    return user["id"] if user else None
