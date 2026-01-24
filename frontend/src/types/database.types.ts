export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
          streak_days: number
          last_activity_date: string | null
          total_study_time_minutes: number
          rank: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
          streak_days?: number
          last_activity_date?: string | null
          total_study_time_minutes?: number
          rank?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
          streak_days?: number
          last_activity_date?: string | null
          total_study_time_minutes?: number
          rank?: string
        }
      }
      topics: {
        Row: {
          id: string
          name: string
          short_name: string
          description: string | null
          icon: string
          color: string
          question_count: number
          data_file: string | null
          display_order: number
          created_at: string
        }
        Insert: {
          id: string
          name: string
          short_name: string
          description?: string | null
          icon?: string
          color?: string
          question_count?: number
          data_file?: string | null
          display_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          short_name?: string
          description?: string | null
          icon?: string
          color?: string
          question_count?: number
          data_file?: string | null
          display_order?: number
          created_at?: string
        }
      }
      questions: {
        Row: {
          id: string
          topic_id: string | null
          question_text: string
          option_1: string
          option_2: string
          option_3: string
          option_4: string
          correct_option: string
          correct_option_index: number
          explanation: string | null
          difficulty: string
          created_at: string
        }
        Insert: {
          id?: string
          topic_id?: string | null
          question_text: string
          option_1: string
          option_2: string
          option_3: string
          option_4: string
          correct_option: string
          correct_option_index: number
          explanation?: string | null
          difficulty?: string
          created_at?: string
        }
        Update: {
          id?: string
          topic_id?: string | null
          question_text?: string
          option_1?: string
          option_2?: string
          option_3?: string
          option_4?: string
          correct_option?: string
          correct_option_index?: number
          explanation?: string | null
          difficulty?: string
          created_at?: string
        }
      }
      user_question_progress: {
        Row: {
          id: string
          user_id: string
          question_id: string
          topic_id: string
          is_correct: boolean | null
          attempts: number
          last_attempted_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          topic_id: string
          is_correct?: boolean | null
          attempts?: number
          last_attempted_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          topic_id?: string
          is_correct?: boolean | null
          attempts?: number
          last_attempted_at?: string
          created_at?: string
        }
      }
      bookmarks: {
        Row: {
          id: string
          user_id: string
          question_id: string
          topic_id: string
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          topic_id: string
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          topic_id?: string
          notes?: string | null
          created_at?: string
        }
      }
      mock_tests: {
        Row: {
          id: string
          name: string
          description: string | null
          duration_minutes: number
          question_count: number
          passing_score: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          name: string
          description?: string | null
          duration_minutes?: number
          question_count?: number
          passing_score?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          duration_minutes?: number
          question_count?: number
          passing_score?: number
          is_active?: boolean
          created_at?: string
        }
      }
      mock_test_attempts: {
        Row: {
          id: string
          user_id: string
          mock_test_id: string
          score: number
          total_questions: number
          correct_answers: number
          time_taken_seconds: number | null
          is_passed: boolean | null
          started_at: string
          completed_at: string | null
          answers: Json
        }
        Insert: {
          id?: string
          user_id: string
          mock_test_id: string
          score: number
          total_questions: number
          correct_answers: number
          time_taken_seconds?: number | null
          is_passed?: boolean | null
          started_at?: string
          completed_at?: string | null
          answers?: Json
        }
        Update: {
          id?: string
          user_id?: string
          mock_test_id?: string
          score?: number
          total_questions?: number
          correct_answers?: number
          time_taken_seconds?: number | null
          is_passed?: boolean | null
          started_at?: string
          completed_at?: string | null
          answers?: Json
        }
      }
      flashcard_progress: {
        Row: {
          id: string
          user_id: string
          question_id: string
          status: string
          review_count: number
          last_reviewed_at: string
          next_review_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          status?: string
          review_count?: number
          last_reviewed_at?: string
          next_review_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          question_id?: string
          status?: string
          review_count?: number
          last_reviewed_at?: string
          next_review_at?: string | null
          created_at?: string
        }
      }
      user_settings: {
        Row: {
          id: string
          user_id: string
          dark_mode: boolean
          sound_effects: boolean
          notifications_enabled: boolean
          email_reminders: boolean
          questions_per_session: number
          auto_advance: boolean
          show_explanations: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          dark_mode?: boolean
          sound_effects?: boolean
          notifications_enabled?: boolean
          email_reminders?: boolean
          questions_per_session?: number
          auto_advance?: boolean
          show_explanations?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          dark_mode?: boolean
          sound_effects?: boolean
          notifications_enabled?: boolean
          email_reminders?: boolean
          questions_per_session?: number
          auto_advance?: boolean
          show_explanations?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      study_sessions: {
        Row: {
          id: string
          user_id: string
          topic_id: string | null
          session_type: string | null
          questions_answered: number
          correct_answers: number
          duration_seconds: number
          started_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          topic_id?: string | null
          session_type?: string | null
          questions_answered?: number
          correct_answers?: number
          duration_seconds?: number
          started_at?: string
          ended_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          topic_id?: string | null
          session_type?: string | null
          questions_answered?: number
          correct_answers?: number
          duration_seconds?: number
          started_at?: string
          ended_at?: string | null
        }
      }
    }
    Views: {
      user_topic_stats: {
        Row: {
          user_id: string
          topic_id: string
          topic_name: string
          questions_attempted: number
          questions_correct: number
          total_questions: number
          progress_percent: number
        }
      }
      user_overall_stats: {
        Row: {
          user_id: string
          streak_days: number
          rank: string
          total_questions_answered: number
          total_correct_answers: number
          total_study_minutes: number
          active_days: number
          mock_tests_passed: number
        }
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row']

// Convenience types
export type Profile = Tables<'profiles'>
export type Topic = Tables<'topics'>
export type Question = Tables<'questions'>
export type Bookmark = Tables<'bookmarks'>
export type MockTest = Tables<'mock_tests'>
export type MockTestAttempt = Tables<'mock_test_attempts'>
export type UserSettings = Tables<'user_settings'>
export type StudySession = Tables<'study_sessions'>
export type UserTopicStats = Views<'user_topic_stats'>
export type UserOverallStats = Views<'user_overall_stats'>
