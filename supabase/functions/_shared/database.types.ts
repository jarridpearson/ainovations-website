export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          acting_user_id: string
          action_type: string
          changed_fields: Json
          created_at: string
          error_message: string | null
          id: string
          status: string
          target_user_id: string
        }
        Insert: {
          acting_user_id: string
          action_type: string
          changed_fields?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          target_user_id: string
        }
        Update: {
          acting_user_id?: string
          action_type?: string
          changed_fields?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          target_user_id?: string
        }
        Relationships: []
      }
      ai_action_packages: {
        Row: {
          actions_included: number
          active: boolean
          created_at: string
          id: string
          package_key: string
          price_cents: number
        }
        Insert: {
          actions_included: number
          active?: boolean
          created_at?: string
          id?: string
          package_key: string
          price_cents: number
        }
        Update: {
          actions_included?: number
          active?: boolean
          created_at?: string
          id?: string
          package_key?: string
          price_cents?: number
        }
        Relationships: []
      }
      ai_analysis: {
        Row: {
          analysis_json: Json | null
          analysis_type: string | null
          completion_tokens: number | null
          created_at: string | null
          credits_used: number | null
          decision_id: string | null
          id: string
          model_used: string | null
          organization_id: string | null
          prompt_tokens: number | null
          scope_group_ids: string[] | null
          scope_target_user_id: string | null
          scope_type: string | null
          total_cost_cents: number | null
          user_id: string | null
        }
        Insert: {
          analysis_json?: Json | null
          analysis_type?: string | null
          completion_tokens?: number | null
          created_at?: string | null
          credits_used?: number | null
          decision_id?: string | null
          id?: string
          model_used?: string | null
          organization_id?: string | null
          prompt_tokens?: number | null
          scope_group_ids?: string[] | null
          scope_target_user_id?: string | null
          scope_type?: string | null
          total_cost_cents?: number | null
          user_id?: string | null
        }
        Update: {
          analysis_json?: Json | null
          analysis_type?: string | null
          completion_tokens?: number | null
          created_at?: string | null
          credits_used?: number | null
          decision_id?: string | null
          id?: string
          model_used?: string | null
          organization_id?: string | null
          prompt_tokens?: number | null
          scope_group_ids?: string[] | null
          scope_target_user_id?: string | null
          scope_type?: string | null
          total_cost_cents?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_chats: {
        Row: {
          answer: string | null
          created_at: string | null
          group_id: string | null
          id: string
          message: string | null
          organization_id: string | null
          question: string
          response: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          message?: string | null
          organization_id?: string | null
          question: string
          response?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          created_at?: string | null
          group_id?: string | null
          id?: string
          message?: string | null
          organization_id?: string | null
          question?: string
          response?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chats_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_ledger: {
        Row: {
          addon_allocation: number
          credit_pool_type: string
          effective_tier: string
          id: string
          monthly_allocation: number
          monthly_credit_limit: number | null
          one_time_top_up_balance: number
          organization_id: string | null
          period_key: string
          recurring_addon_allocation: number
          reset_date: string | null
          tier_priority_limit: number | null
          updated_at: string | null
          used_credits: number
          user_id: string | null
        }
        Insert: {
          addon_allocation?: number
          credit_pool_type?: string
          effective_tier: string
          id?: string
          monthly_allocation?: number
          monthly_credit_limit?: number | null
          one_time_top_up_balance?: number
          organization_id?: string | null
          period_key: string
          recurring_addon_allocation?: number
          reset_date?: string | null
          tier_priority_limit?: number | null
          updated_at?: string | null
          used_credits?: number
          user_id?: string | null
        }
        Update: {
          addon_allocation?: number
          credit_pool_type?: string
          effective_tier?: string
          id?: string
          monthly_allocation?: number
          monthly_credit_limit?: number | null
          one_time_top_up_balance?: number
          organization_id?: string | null
          period_key?: string
          recurring_addon_allocation?: number
          reset_date?: string | null
          tier_priority_limit?: number | null
          updated_at?: string | null
          used_credits?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_review_settings: {
        Row: {
          auto_monthly_enabled: boolean
          auto_weekly_enabled: boolean
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_monthly_enabled?: boolean
          auto_weekly_enabled?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_monthly_enabled?: boolean
          auto_weekly_enabled?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      decision_scores: {
        Row: {
          created_at: string | null
          decision_id: string | null
          id: string
          reasoning: string | null
          score_label: string | null
          score_value: number | null
        }
        Insert: {
          created_at?: string | null
          decision_id?: string | null
          id?: string
          reasoning?: string | null
          score_label?: string | null
          score_value?: number | null
        }
        Update: {
          created_at?: string | null
          decision_id?: string | null
          id?: string
          reasoning?: string | null
          score_label?: string | null
          score_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_scores_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          active_priority_snapshot: Json | null
          actual_outcome: string | null
          analysis_tier: string | null
          analyzed_at: string | null
          created_at: string | null
          decision_type: string | null
          description: string | null
          direction_label: string | null
          expected_outcome: string | null
          goal_id: string | null
          group_id: string | null
          id: string
          organization_id: string | null
          priority_id: string | null
          status: string
          title: string
          user_id: string | null
        }
        Insert: {
          active_priority_snapshot?: Json | null
          actual_outcome?: string | null
          analysis_tier?: string | null
          analyzed_at?: string | null
          created_at?: string | null
          decision_type?: string | null
          description?: string | null
          direction_label?: string | null
          expected_outcome?: string | null
          goal_id?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          status?: string
          title: string
          user_id?: string | null
        }
        Update: {
          active_priority_snapshot?: Json | null
          actual_outcome?: string | null
          analysis_tier?: string | null
          analyzed_at?: string | null
          created_at?: string | null
          decision_type?: string | null
          description?: string | null
          direction_label?: string | null
          expected_outcome?: string | null
          goal_id?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          status?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decisions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_priority_id_fkey"
            columns: ["priority_id"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_context: {
        Row: {
          created_at: string | null
          id: string
          mission: string | null
          organization_id: string | null
          updated_at: string | null
          user_id: string | null
          values: string[] | null
          vision: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mission?: string | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          values?: string[] | null
          vision?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mission?: string | null
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          values?: string[] | null
          vision?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string | null
          description: string | null
          goal_type: string
          id: string
          organization_id: string | null
          priority_id: string | null
          status: string
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          goal_type?: string
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          status?: string
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          goal_type?: string
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          status?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_priority_id_fkey"
            columns: ["priority_id"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          created_at: string
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      health_score_snapshots: {
        Row: {
          activity_summary: Json | null
          created_at: string | null
          id: string
          score_period: string
          score_value: number
          user_id: string
        }
        Insert: {
          activity_summary?: Json | null
          created_at?: string | null
          id?: string
          score_period: string
          score_value: number
          user_id: string
        }
        Update: {
          activity_summary?: Json | null
          created_at?: string | null
          id?: string
          score_period?: string
          score_value?: number
          user_id?: string
        }
        Relationships: []
      }
      master_admin_users: {
        Row: {
          account_email: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          account_email: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          account_email?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      metric_observations: {
        Row: {
          id: string
          metric_id: string | null
          note: string | null
          purge_after: string | null
          recorded_at: string | null
          retired_at: string | null
          status: string
          value: number | null
        }
        Insert: {
          id?: string
          metric_id?: string | null
          note?: string | null
          purge_after?: string | null
          recorded_at?: string | null
          retired_at?: string | null
          status?: string
          value?: number | null
        }
        Update: {
          id?: string
          metric_id?: string | null
          note?: string | null
          purge_after?: string | null
          recorded_at?: string | null
          retired_at?: string | null
          status?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_observations_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics: {
        Row: {
          better_when: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          goal_id: string | null
          group_id: string | null
          id: string
          organization_id: string | null
          priority_id: string | null
          purge_after: string | null
          retired_at: string | null
          status: string
          title: string
          unit: string | null
          user_id: string | null
        }
        Insert: {
          better_when?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          goal_id?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          purge_after?: string | null
          retired_at?: string | null
          status?: string
          title: string
          unit?: string | null
          user_id?: string | null
        }
        Update: {
          better_when?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          goal_id?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          priority_id?: string | null
          purge_after?: string | null
          retired_at?: string | null
          status?: string
          title?: string
          unit?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metrics_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_priority_id_fkey"
            columns: ["priority_id"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_entitlements: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          latest_transaction_id: string | null
          original_transaction_id: string | null
          platform: string
          product_id: string
          status: string
          tier: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          latest_transaction_id?: string | null
          original_transaction_id?: string | null
          platform: string
          product_id: string
          status: string
          tier: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          latest_transaction_id?: string | null
          original_transaction_id?: string | null
          platform?: string
          product_id?: string
          status?: string
          tier?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          evening_reflection_enabled: boolean | null
          id: string
          monthly_review_enabled: boolean | null
          morning_focus_enabled: boolean | null
          progress_reminder_enabled: boolean | null
          timezone: string | null
          updated_at: string | null
          user_id: string
          weekly_summary_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          evening_reflection_enabled?: boolean | null
          id?: string
          monthly_review_enabled?: boolean | null
          morning_focus_enabled?: boolean | null
          progress_reminder_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
          weekly_summary_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          evening_reflection_enabled?: boolean | null
          id?: string
          monthly_review_enabled?: boolean | null
          morning_focus_enabled?: boolean | null
          progress_reminder_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          weekly_summary_enabled?: boolean | null
        }
        Relationships: []
      }
      observations: {
        Row: {
          created_at: string | null
          id: string
          metric_id: string
          notes: string | null
          observed_at: string | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          metric_id: string
          notes?: string | null
          observed_at?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metric_id?: string
          notes?: string | null
          observed_at?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observations_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_ai_question_sources: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          question_id: string
          source_label: string
          source_record_id: string | null
          source_snapshot: Json
          source_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          question_id: string
          source_label: string
          source_record_id?: string | null
          source_snapshot?: Json
          source_type: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          question_id?: string
          source_label?: string
          source_record_id?: string | null
          source_snapshot?: Json
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_ai_question_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_ai_question_sources_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "organization_ai_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_ai_questions: {
        Row: {
          answer_status: string
          answer_text: string | null
          asked_by_user_id: string
          completed_at: string | null
          completion_tokens: number
          created_at: string
          credit_refunded_at: string | null
          credit_status: string
          credits_used: number
          data_snapshot: Json
          error_message: string | null
          id: string
          model_used: string | null
          organization_id: string
          portal_view: string
          prompt_tokens: number
          question_text: string
          request_id: string | null
          scope_snapshot: Json
        }
        Insert: {
          answer_status?: string
          answer_text?: string | null
          asked_by_user_id: string
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          credit_refunded_at?: string | null
          credit_status?: string
          credits_used?: number
          data_snapshot?: Json
          error_message?: string | null
          id?: string
          model_used?: string | null
          organization_id: string
          portal_view: string
          prompt_tokens?: number
          question_text: string
          request_id?: string | null
          scope_snapshot?: Json
        }
        Update: {
          answer_status?: string
          answer_text?: string | null
          asked_by_user_id?: string
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          credit_refunded_at?: string | null
          credit_status?: string
          credits_used?: number
          data_snapshot?: Json
          error_message?: string | null
          id?: string
          model_used?: string | null
          organization_id?: string
          portal_view?: string
          prompt_tokens?: number
          question_text?: string
          request_id?: string | null
          scope_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "organization_ai_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_billing_change_requests: {
        Row: {
          applied_at: string | null
          canceled_at: string | null
          change_status: string
          change_type: string
          created_at: string
          current_addon_quantity: number | null
          current_billing_interval: string | null
          current_plan_key: string | null
          current_seat_quantity: number | null
          effective_at: string | null
          error_message: string | null
          id: string
          metadata: Json
          organization_id: string
          requested_addon_quantity: number | null
          requested_billing_interval: string | null
          requested_by_user_id: string | null
          requested_plan_key: string | null
          requested_seat_quantity: number | null
          stripe_invoice_id: string | null
          stripe_schedule_id: string | null
          stripe_subscription_id: string | null
          stripe_subscription_item_id: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          canceled_at?: string | null
          change_status?: string
          change_type: string
          created_at?: string
          current_addon_quantity?: number | null
          current_billing_interval?: string | null
          current_plan_key?: string | null
          current_seat_quantity?: number | null
          effective_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          requested_addon_quantity?: number | null
          requested_billing_interval?: string | null
          requested_by_user_id?: string | null
          requested_plan_key?: string | null
          requested_seat_quantity?: number | null
          stripe_invoice_id?: string | null
          stripe_schedule_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          canceled_at?: string | null
          change_status?: string
          change_type?: string
          created_at?: string
          current_addon_quantity?: number | null
          current_billing_interval?: string | null
          current_plan_key?: string | null
          current_seat_quantity?: number | null
          effective_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          requested_addon_quantity?: number | null
          requested_billing_interval?: string | null
          requested_by_user_id?: string | null
          requested_plan_key?: string | null
          requested_seat_quantity?: number | null
          stripe_invoice_id?: string | null
          stripe_schedule_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_billing_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_billing_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          new_paid_seat_count: number | null
          new_plan_key: string | null
          new_subscription_status: string | null
          organization_id: string | null
          previous_paid_seat_count: number | null
          previous_plan_key: string | null
          previous_subscription_status: string | null
          stripe_event_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          new_paid_seat_count?: number | null
          new_plan_key?: string | null
          new_subscription_status?: string | null
          organization_id?: string | null
          previous_paid_seat_count?: number | null
          previous_plan_key?: string | null
          previous_subscription_status?: string | null
          stripe_event_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          new_paid_seat_count?: number | null
          new_plan_key?: string | null
          new_subscription_status?: string | null
          organization_id?: string | null
          previous_paid_seat_count?: number | null
          previous_plan_key?: string | null
          previous_subscription_status?: string | null
          stripe_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_billing_events_stripe_event_id_fkey"
            columns: ["stripe_event_id"]
            isOneToOne: false
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["stripe_event_id"]
          },
        ]
      }
      organization_billing_products: {
        Row: {
          active: boolean
          app_pool_credits_per_unit: number | null
          billing_interval: string
          created_at: string
          portal_credits_per_unit: number | null
          product_key: string
          product_name: string
          product_type: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          unit_amount_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          app_pool_credits_per_unit?: number | null
          billing_interval: string
          created_at?: string
          portal_credits_per_unit?: number | null
          product_key: string
          product_name: string
          product_type: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          unit_amount_cents: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          app_pool_credits_per_unit?: number | null
          billing_interval?: string
          created_at?: string
          portal_credits_per_unit?: number | null
          product_key?: string
          product_name?: string
          product_type?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          unit_amount_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      organization_checkout_requests: {
        Row: {
          app_credit_addon_product_key: string | null
          billing_interval: string
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          plan_key: string
          portal_credit_addon_product_key: string | null
          request_id: string
          request_status: string
          requested_by_user_id: string
          seat_quantity: number
          stripe_checkout_session_id: string | null
          stripe_checkout_url: string | null
          updated_at: string
        }
        Insert: {
          app_credit_addon_product_key?: string | null
          billing_interval: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          plan_key: string
          portal_credit_addon_product_key?: string | null
          request_id: string
          request_status?: string
          requested_by_user_id: string
          seat_quantity: number
          stripe_checkout_session_id?: string | null
          stripe_checkout_url?: string | null
          updated_at?: string
        }
        Update: {
          app_credit_addon_product_key?: string | null
          billing_interval?: string
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          plan_key?: string
          portal_credit_addon_product_key?: string | null
          request_id?: string
          request_status?: string
          requested_by_user_id?: string
          seat_quantity?: number
          stripe_checkout_session_id?: string | null
          stripe_checkout_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_checkout_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_checkout_requests_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      organization_feature_settings: {
        Row: {
          created_at: string
          created_by_scope: string
          edit_scope: string
          feature_key: string
          id: string
          organization_id: string
          sharing_scope: string
          updated_at: string
          view_scope: string
        }
        Insert: {
          created_at?: string
          created_by_scope: string
          edit_scope: string
          feature_key: string
          id?: string
          organization_id: string
          sharing_scope: string
          updated_at?: string
          view_scope: string
        }
        Update: {
          created_at?: string
          created_by_scope?: string
          edit_scope?: string
          feature_key?: string
          id?: string
          organization_id?: string
          sharing_scope?: string
          updated_at?: string
          view_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_feature_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_group_admins: {
        Row: {
          admin_role: string
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_role: string
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_role?: string
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_group_admins_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_group_admins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_group_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_group_users: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          is_primary: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_group_users_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_group_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_group_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_group_id: string | null
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_group_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_group_id?: string | null
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_groups_parent_group_id_fkey"
            columns: ["parent_group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_knowledge_bases: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          openai_vector_store_id: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          openai_vector_store_id?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          openai_vector_store_id?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_knowledge_bases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_knowledge_documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          document_status: string
          error_message: string | null
          file_name: string
          file_size_bytes: number
          id: string
          is_active: boolean
          knowledge_base_id: string
          mime_type: string
          openai_file_id: string | null
          openai_vector_store_file_id: string | null
          organization_id: string
          processed_at: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          document_status?: string
          error_message?: string | null
          file_name: string
          file_size_bytes: number
          id?: string
          is_active?: boolean
          knowledge_base_id: string
          mime_type: string
          openai_file_id?: string | null
          openai_vector_store_file_id?: string | null
          organization_id: string
          processed_at?: string | null
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          document_status?: string
          error_message?: string | null
          file_name?: string
          file_size_bytes?: number
          id?: string
          is_active?: boolean
          knowledge_base_id?: string
          mime_type?: string
          openai_file_id?: string | null
          openai_vector_store_file_id?: string | null
          organization_id?: string
          processed_at?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_knowledge_documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "organization_knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_knowledge_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_knowledge_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          document_id: string | null
          event_metadata: Json
          event_type: string
          id: string
          organization_id: string
          question_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          event_metadata?: Json
          event_type: string
          id?: string
          organization_id: string
          question_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          event_metadata?: Json
          event_type?: string
          id?: string
          organization_id?: string
          question_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_knowledge_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "organization_knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_knowledge_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_knowledge_events_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "organization_knowledge_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_knowledge_questions: {
        Row: {
          answer_status: string
          answer_text: string | null
          asked_by_user_id: string
          citations: Json
          completed_at: string | null
          completion_tokens: number
          created_at: string
          credit_refunded_at: string | null
          credit_status: string
          credits_used: number
          error_message: string | null
          id: string
          model_used: string | null
          organization_id: string
          prompt_tokens: number
          question_text: string
          request_id: string | null
        }
        Insert: {
          answer_status?: string
          answer_text?: string | null
          asked_by_user_id: string
          citations?: Json
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          credit_refunded_at?: string | null
          credit_status?: string
          credits_used?: number
          error_message?: string | null
          id?: string
          model_used?: string | null
          organization_id: string
          prompt_tokens?: number
          question_text: string
          request_id?: string | null
        }
        Update: {
          answer_status?: string
          answer_text?: string | null
          asked_by_user_id?: string
          citations?: Json
          completed_at?: string | null
          completion_tokens?: number
          created_at?: string
          credit_refunded_at?: string | null
          credit_status?: string
          credits_used?: number
          error_message?: string | null
          id?: string
          model_used?: string | null
          organization_id?: string
          prompt_tokens?: number
          question_text?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_knowledge_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_priorities: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          position: number
          priority_code: string
          priority_description: string | null
          priority_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          position: number
          priority_code: string
          priority_description?: string | null
          priority_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          position?: number
          priority_code?: string
          priority_description?: string | null
          priority_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_priorities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_user_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          full_name: string | null
          id: string
          import_batch_id: string | null
          invitation_sent_at: string | null
          invited_by: string
          organization_id: string
          primary_group_id: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          import_batch_id?: string | null
          invitation_sent_at?: string | null
          invited_by: string
          organization_id: string
          primary_group_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          import_batch_id?: string | null
          invitation_sent_at?: string | null
          invited_by?: string
          organization_id?: string
          primary_group_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_user_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_user_invitations_primary_group_id_fkey"
            columns: ["primary_group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_users: {
        Row: {
          app_access_activated_at: string | null
          billing_access_enabled: boolean
          can_add_users: boolean
          can_assign_admins: boolean
          can_assign_goals: boolean | null
          can_create_goals: boolean | null
          can_manage_groups: boolean
          can_purchase_seats: boolean
          can_remove_users: boolean
          can_view_ai_credits: boolean
          created_at: string | null
          id: string
          import_group_label: string | null
          is_active: boolean
          is_billable: boolean
          manager_portal_access_enabled: boolean
          organization_id: string | null
          portal_access_enabled: boolean
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          app_access_activated_at?: string | null
          billing_access_enabled?: boolean
          can_add_users?: boolean
          can_assign_admins?: boolean
          can_assign_goals?: boolean | null
          can_create_goals?: boolean | null
          can_manage_groups?: boolean
          can_purchase_seats?: boolean
          can_remove_users?: boolean
          can_view_ai_credits?: boolean
          created_at?: string | null
          id?: string
          import_group_label?: string | null
          is_active?: boolean
          is_billable?: boolean
          manager_portal_access_enabled?: boolean
          organization_id?: string | null
          portal_access_enabled?: boolean
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          app_access_activated_at?: string | null
          billing_access_enabled?: boolean
          can_add_users?: boolean
          can_assign_admins?: boolean
          can_assign_goals?: boolean | null
          can_create_goals?: boolean | null
          can_manage_groups?: boolean
          can_purchase_seats?: boolean
          can_remove_users?: boolean
          can_view_ai_credits?: boolean
          created_at?: string | null
          id?: string
          import_group_label?: string | null
          is_active?: boolean
          is_billable?: boolean
          manager_portal_access_enabled?: boolean
          organization_id?: string | null
          portal_access_enabled?: boolean
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: Json | null
          billing_email: string | null
          billing_interval: string | null
          created_at: string | null
          current_billing_period_end: string | null
          current_billing_period_start: string | null
          current_plan_key: string | null
          free_finance_admin_used: boolean
          id: string
          industry: string | null
          main_contact_email: string | null
          main_contact_name: string | null
          main_contact_phone: string | null
          manager_portal_access_mode: string
          mission_statement: string | null
          name: string
          notes: string | null
          onboarding_stage: string
          org_goal_editor_level: string | null
          owner_id: string | null
          paid_seat_count: number
          pending_billing_interval: string | null
          pending_paid_seat_count: number | null
          pending_plan_effective_at: string | null
          pending_plan_key: string | null
          pending_seat_effective_at: string | null
          pending_subscription_cancel_at: string | null
          personal_goal_editor_level: string | null
          phone: string | null
          pricing_version: string | null
          priority_control_model: string | null
          priority_editor_level: string | null
          requested_seat_count: number | null
          seat_limit: number
          seat_used: number
          seats_total: number | null
          seats_used: number | null
          setup_complete: boolean | null
          stripe_addon_subscription_id: string | null
          stripe_billing_error: string | null
          stripe_billing_synced_at: string | null
          stripe_cancel_at_period_end: boolean
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_latest_invoice_id: string | null
          stripe_primary_price_id: string | null
          stripe_subscription_id: string | null
          stripe_subscription_item_id: string | null
          subscription_status: string | null
          subscription_tier: string | null
          values_statement: string | null
          vision_statement: string | null
        }
        Insert: {
          address?: Json | null
          billing_email?: string | null
          billing_interval?: string | null
          created_at?: string | null
          current_billing_period_end?: string | null
          current_billing_period_start?: string | null
          current_plan_key?: string | null
          free_finance_admin_used?: boolean
          id?: string
          industry?: string | null
          main_contact_email?: string | null
          main_contact_name?: string | null
          main_contact_phone?: string | null
          manager_portal_access_mode?: string
          mission_statement?: string | null
          name: string
          notes?: string | null
          onboarding_stage?: string
          org_goal_editor_level?: string | null
          owner_id?: string | null
          paid_seat_count?: number
          pending_billing_interval?: string | null
          pending_paid_seat_count?: number | null
          pending_plan_effective_at?: string | null
          pending_plan_key?: string | null
          pending_seat_effective_at?: string | null
          pending_subscription_cancel_at?: string | null
          personal_goal_editor_level?: string | null
          phone?: string | null
          pricing_version?: string | null
          priority_control_model?: string | null
          priority_editor_level?: string | null
          requested_seat_count?: number | null
          seat_limit?: number
          seat_used?: number
          seats_total?: number | null
          seats_used?: number | null
          setup_complete?: boolean | null
          stripe_addon_subscription_id?: string | null
          stripe_billing_error?: string | null
          stripe_billing_synced_at?: string | null
          stripe_cancel_at_period_end?: boolean
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_latest_invoice_id?: string | null
          stripe_primary_price_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          values_statement?: string | null
          vision_statement?: string | null
        }
        Update: {
          address?: Json | null
          billing_email?: string | null
          billing_interval?: string | null
          created_at?: string | null
          current_billing_period_end?: string | null
          current_billing_period_start?: string | null
          current_plan_key?: string | null
          free_finance_admin_used?: boolean
          id?: string
          industry?: string | null
          main_contact_email?: string | null
          main_contact_name?: string | null
          main_contact_phone?: string | null
          manager_portal_access_mode?: string
          mission_statement?: string | null
          name?: string
          notes?: string | null
          onboarding_stage?: string
          org_goal_editor_level?: string | null
          owner_id?: string | null
          paid_seat_count?: number
          pending_billing_interval?: string | null
          pending_paid_seat_count?: number | null
          pending_plan_effective_at?: string | null
          pending_plan_key?: string | null
          pending_seat_effective_at?: string | null
          pending_subscription_cancel_at?: string | null
          personal_goal_editor_level?: string | null
          phone?: string | null
          pricing_version?: string | null
          priority_control_model?: string | null
          priority_editor_level?: string | null
          requested_seat_count?: number | null
          seat_limit?: number
          seat_used?: number
          seats_total?: number | null
          seats_used?: number | null
          setup_complete?: boolean | null
          stripe_addon_subscription_id?: string | null
          stripe_billing_error?: string | null
          stripe_billing_synced_at?: string | null
          stripe_cancel_at_period_end?: boolean
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_latest_invoice_id?: string | null
          stripe_primary_price_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          values_statement?: string | null
          vision_statement?: string | null
        }
        Relationships: []
      }
      pending_signups: {
        Row: {
          checkout_payload: Json
          converted_organization_id: string | null
          converted_user_id: string | null
          created_at: string
          email: string
          id: string
          onboarding_payload: Json
          password: string | null
          plan: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_status: string | null
          updated_at: string
        }
        Insert: {
          checkout_payload?: Json
          converted_organization_id?: string | null
          converted_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          onboarding_payload?: Json
          password?: string | null
          plan: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_status?: string | null
          updated_at?: string
        }
        Update: {
          checkout_payload?: Json
          converted_organization_id?: string | null
          converted_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          onboarding_payload?: Json
          password?: string | null
          plan?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      priorities: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string | null
          group_id: string | null
          id: string
          organization_id: string | null
          purge_after: string | null
          retired_at: string | null
          retired_reason: string | null
          sort_order: number | null
          status: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          purge_after?: string | null
          retired_at?: string | null
          retired_reason?: string | null
          sort_order?: number | null
          status?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          group_id?: string | null
          id?: string
          organization_id?: string | null
          purge_after?: string | null
          retired_at?: string | null
          retired_reason?: string | null
          sort_order?: number | null
          status?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "priorities_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "organization_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priorities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_email: string | null
          account_type: string | null
          auth_provider: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          import_group_label: string | null
          industry: string | null
          marketing_opt_in: boolean | null
          marketing_opt_in_at: string | null
          onboarding_state: string | null
          organization_id: string | null
          phone: string | null
          role: string | null
          role_title: string | null
          subscription_status: string | null
          subscription_tier: string | null
          updated_at: string | null
        }
        Insert: {
          account_email?: string | null
          account_type?: string | null
          auth_provider?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          import_group_label?: string | null
          industry?: string | null
          marketing_opt_in?: boolean | null
          marketing_opt_in_at?: string | null
          onboarding_state?: string | null
          organization_id?: string | null
          phone?: string | null
          role?: string | null
          role_title?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Update: {
          account_email?: string | null
          account_type?: string | null
          auth_provider?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          import_group_label?: string | null
          industry?: string | null
          marketing_opt_in?: boolean | null
          marketing_opt_in_at?: string | null
          onboarding_state?: string | null
          organization_id?: string | null
          phone?: string | null
          role?: string | null
          role_title?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_billing_prices: {
        Row: {
          active: boolean
          billing_interval: string
          billing_product_key: string | null
          component_key: string
          created_at: string
          credits_per_unit: number | null
          id: string
          plan_key: string
          stripe_price_id: string
          stripe_product_id: string | null
          unit_amount_cents: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_interval: string
          billing_product_key?: string | null
          component_key: string
          created_at?: string
          credits_per_unit?: number | null
          id?: string
          plan_key: string
          stripe_price_id: string
          stripe_product_id?: string | null
          unit_amount_cents?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_interval?: string
          billing_product_key?: string | null
          component_key?: string
          created_at?: string
          credits_per_unit?: number | null
          id?: string
          plan_key?: string
          stripe_price_id?: string
          stripe_product_id?: string | null
          unit_amount_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_billing_prices_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_type: string
          last_error: string | null
          livemode: boolean | null
          payload: Json
          processed_at: string | null
          processing_attempts: number
          processing_status: string
          received_at: string
          stripe_api_version: string | null
          stripe_created_at: string | null
          stripe_event_id: string
          updated_at: string
        }
        Insert: {
          event_type: string
          last_error?: string | null
          livemode?: boolean | null
          payload: Json
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          received_at?: string
          stripe_api_version?: string | null
          stripe_created_at?: string | null
          stripe_event_id: string
          updated_at?: string
        }
        Update: {
          event_type?: string
          last_error?: string | null
          livemode?: boolean | null
          payload?: Json
          processed_at?: string | null
          processing_attempts?: number
          processing_status?: string
          received_at?: string
          stripe_api_version?: string | null
          stripe_created_at?: string | null
          stripe_event_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          account_level: string
          active: boolean
          allowed_company_document_types: string[]
          allows_advanced_reporting: boolean
          allows_company_activity_questions: boolean
          allows_company_data_questions: boolean
          allows_company_document_questions: boolean
          allows_full_data_export: boolean
          allows_personal_data_questions: boolean
          annual_price_cents: number | null
          billing_model: string
          company_document_limit: number
          created_at: string
          id: string
          included_admin_ai_credits_monthly: number | null
          included_ai_actions_monthly: number | null
          included_user_ai_credits_monthly: number | null
          monthly_price_cents: number | null
          overage_allowed: boolean
          per_user_annual_price_cents: number | null
          per_user_monthly_price_cents: number | null
          plan_key: string
          plan_name: string
          portal_annual_price_cents: number | null
          portal_monthly_price_cents: number | null
        }
        Insert: {
          account_level: string
          active?: boolean
          allowed_company_document_types?: string[]
          allows_advanced_reporting?: boolean
          allows_company_activity_questions?: boolean
          allows_company_data_questions?: boolean
          allows_company_document_questions?: boolean
          allows_full_data_export?: boolean
          allows_personal_data_questions?: boolean
          annual_price_cents?: number | null
          billing_model: string
          company_document_limit?: number
          created_at?: string
          id?: string
          included_admin_ai_credits_monthly?: number | null
          included_ai_actions_monthly?: number | null
          included_user_ai_credits_monthly?: number | null
          monthly_price_cents?: number | null
          overage_allowed?: boolean
          per_user_annual_price_cents?: number | null
          per_user_monthly_price_cents?: number | null
          plan_key: string
          plan_name: string
          portal_annual_price_cents?: number | null
          portal_monthly_price_cents?: number | null
        }
        Update: {
          account_level?: string
          active?: boolean
          allowed_company_document_types?: string[]
          allows_advanced_reporting?: boolean
          allows_company_activity_questions?: boolean
          allows_company_data_questions?: boolean
          allows_company_document_questions?: boolean
          allows_full_data_export?: boolean
          allows_personal_data_questions?: boolean
          annual_price_cents?: number | null
          billing_model?: string
          company_document_limit?: number
          created_at?: string
          id?: string
          included_admin_ai_credits_monthly?: number | null
          included_ai_actions_monthly?: number | null
          included_user_ai_credits_monthly?: number | null
          monthly_price_cents?: number | null
          overage_allowed?: boolean
          per_user_annual_price_cents?: number | null
          per_user_monthly_price_cents?: number | null
          plan_key?: string
          plan_name?: string
          portal_annual_price_cents?: number | null
          portal_monthly_price_cents?: number | null
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          feature_key: string
          group_id: string | null
          id: string
          metadata: Json
          organization_id: string | null
          route: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          feature_key: string
          group_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string | null
          route: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          feature_key?: string
          group_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string | null
          route?: string
          user_id?: string
        }
        Relationships: []
      }
      user_account_controls: {
        Row: {
          can_login: boolean | null
          is_active: boolean | null
          is_locked: boolean | null
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          can_login?: boolean | null
          is_active?: boolean | null
          is_locked?: boolean | null
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          can_login?: boolean | null
          is_active?: boolean | null
          is_locked?: boolean | null
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_priorities: {
        Row: {
          created_at: string | null
          id: string
          position: number
          priority_code: string
          priority_description: string
          priority_name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          position: number
          priority_code: string
          priority_description: string
          priority_name: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          position?: number
          priority_code?: string
          priority_description?: string
          priority_name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_subscription_settings: {
        Row: {
          created_at: string
          effective_tier: string
          id: string
          recurring_addon_allocation: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          effective_tier?: string
          id?: string
          recurring_addon_allocation?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          effective_tier?: string
          id?: string
          recurring_addon_allocation?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_organization_seat_reduction: {
        Args: { p_organization_id: string; p_target_seat_count: number }
        Returns: {
          deactivated_user_count: number
          remaining_billable_user_count: number
        }[]
      }
      apply_verified_personal_entitlements: {
        Args: {
          p_effective_tier: string
          p_recurring_addon_allocation: number
          p_user_id: string
        }
        Returns: {
          addon_allocation: number
          effective_tier: string
          id: string
          monthly_allocation: number
          one_time_top_up_balance: number
          period_key: string
          recurring_addon_allocation: number
          used_credits: number
        }[]
      }
      can_add_user: { Args: { p_org_id: string }; Returns: boolean }
      consume_organization_app_credits: {
        Args: {
          p_credit_cost: number
          p_event_type: string
          p_feature_key: string
          p_metadata?: Json
          p_organization_id: string
          p_request_id: string
          p_route: string
          p_user_id: string
        }
        Returns: {
          already_consumed: boolean
          app_credit_renewal_date: string
          app_credits_available: number
          app_credits_used: number
        }[]
      }
      consume_organization_portal_credits: {
        Args: {
          p_credit_cost: number
          p_event_type: string
          p_feature_key: string
          p_metadata?: Json
          p_organization_id: string
          p_route: string
          p_user_id: string
        }
        Returns: {
          portal_credit_renewal_date: string
          portal_credits_available: number
          portal_credits_used: number
        }[]
      }
      consume_personal_app_credits: {
        Args: {
          p_credit_cost: number
          p_event_type: string
          p_feature_key: string
          p_metadata?: Json
          p_request_id: string
          p_route: string
          p_user_id: string
        }
        Returns: {
          already_consumed: boolean
          app_credits_available: number
          app_credits_used: number
          period_key: string
        }[]
      }
      create_managed_organization_group: {
        Args: {
          p_description?: string
          p_name: string
          p_organization_id: string
          p_parent_group_id?: string
        }
        Returns: string
      }
      deactivate_managed_organization_group: {
        Args: { p_group_id: string; p_organization_id: string }
        Returns: undefined
      }
      get_authorized_everward_user_data: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_decision_analysis_for_export: {
        Args: { p_decision_ids: string[]; p_organization_id: string }
        Returns: {
          alignment_signal: string
          analysis_created_at: string
          analysis_id: string
          analysis_label: string
          analysis_note: string
          analysis_summary: string
          analysis_type: string
          better_next_decision: string
          credits_used: number
          decision_id: string
          decision_pattern_read: string
          evidence_quality: string
          execution_risk: string
          highest_leverage_followup: string
          insight_level: string
          next_step: string
          priority_alignment: string
          priority_pressure: string
          risk_tradeoff: string
          suggested_trackable: string
        }[]
      }
      get_effective_app_credit_summary: {
        Args: never
        Returns: {
          addon_allocation: number
          available_credits: number
          credit_source: string
          effective_tier: string
          monthly_allocation: number
          one_time_top_up_balance: number
          organization_id: string
          organization_name: string
          recurring_addon_allocation: number
          renewal_date: string
          total_credits: number
          used_credits: number
        }[]
      }
      get_organization_ai_credit_summary: {
        Args: { p_organization_id: string }
        Returns: {
          ai_credit_period_start: string
          ai_credit_renewal_date: string
          ai_credits_available: number
          ai_credits_used: number
        }[]
      }
      get_organization_credit_breakdown: {
        Args: { p_organization_id: string }
        Returns: {
          credit_pool_type: string
          included_monthly_credits: number
          recurring_addon_credits: number
          remaining_credits: number
          renewal_date: string
          total_monthly_credits: number
          used_credits: number
        }[]
      }
      get_organization_portal_credit_summary: {
        Args: { p_organization_id: string }
        Returns: {
          portal_credit_period_start: string
          portal_credit_renewal_date: string
          portal_credits_available: number
          portal_credits_used: number
        }[]
      }
      get_organization_priority_detail_report: {
        Args: {
          p_group_ids?: string[]
          p_organization_id: string
          p_priority_status: string
          p_user_ids?: string[]
        }
        Returns: {
          decisions: Json
          group_id: string
          group_name: string
          priority_completed_at: string
          priority_created_at: string
          priority_description: string
          priority_id: string
          priority_retired_at: string
          priority_status: string
          priority_title: string
          trackables: Json
          user_email: string
          user_full_name: string
          user_id: string
        }[]
      }
      get_organization_seat_summary: {
        Args: { p_organization_id: string }
        Returns: {
          available_seat_count: number
          purchased_seat_count: number
          used_seat_count: number
        }[]
      }
      get_organization_settings: {
        Args: { p_organization_id: string }
        Returns: {
          manager_portal_access_mode: string
          mission_statement: string
          organization_name: string
          values_statement: string
          vision_statement: string
        }[]
      }
      get_organization_usage_report: {
        Args: {
          p_group_ids?: string[]
          p_organization_id: string
          p_user_ids?: string[]
        }
        Returns: {
          ai_credits_used: number
          decision_count: number
          priority_count: number
          selected_user_count: number
          trackable_count: number
        }[]
      }
      get_organization_user_directory: {
        Args: { p_organization_id: string }
        Returns: {
          billing_access_enabled: boolean
          email_address: string
          full_name: string
          is_active: boolean
          is_billable: boolean
          is_organization_owner: boolean
          manager_portal_access_enabled: boolean
          manager_portal_access_mode: string
          organization_role: string
          organization_user_id: string
          primary_group_id: string
          primary_group_name: string
          user_id: string
        }[]
      }
      get_organization_visible_groups: {
        Args: { p_organization_id: string }
        Returns: {
          can_manage_group: boolean
          group_description: string
          group_id: string
          group_name: string
          is_active: boolean
          parent_group_id: string
        }[]
      }
      get_organization_visible_user_ids: {
        Args: { p_organization_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_trackable_entries_for_export: {
        Args: { p_organization_id: string; p_trackable_ids: string[] }
        Returns: {
          entry_id: string
          entry_note: string
          entry_recorded_at: string
          entry_status: string
          entry_value: string
          trackable_id: string
        }[]
      }
      master_admin_set_personal_app_tier: {
        Args: { p_tier: string }
        Returns: {
          addon_allocation: number
          available_credits: number
          effective_tier: string
          ledger_id: string
          monthly_allocation: number
          one_time_top_up_balance: number
          period_key: string
          recurring_addon_allocation: number
          used_credits: number
        }[]
      }
      organization_has_company_knowledge_access: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      purge_retired_priority_data: { Args: never; Returns: undefined }
      refund_organization_app_credits: {
        Args: {
          p_credit_cost: number
          p_event_type: string
          p_feature_key: string
          p_metadata?: Json
          p_organization_id: string
          p_reason: string
          p_request_id: string
          p_route: string
          p_user_id: string
        }
        Returns: {
          already_refunded: boolean
          app_credit_renewal_date: string
          app_credits_available: number
          app_credits_used: number
        }[]
      }
      refund_organization_portal_credits:
        | {
            Args: {
              p_credit_cost: number
              p_event_type: string
              p_feature_key: string
              p_metadata?: Json
              p_organization_id: string
              p_route: string
              p_user_id: string
            }
            Returns: {
              portal_credit_renewal_date: string
              portal_credits_available: number
              portal_credits_used: number
            }[]
          }
        | {
            Args: {
              p_credit_cost: number
              p_organization_id: string
              p_question_id: string
              p_reason: string
              p_request_id: string
              p_user_id: string
            }
            Returns: {
              portal_credit_renewal_date: string
              portal_credits_available: number
              portal_credits_used: number
            }[]
          }
      refund_personal_app_credits: {
        Args: {
          p_credit_cost: number
          p_event_type: string
          p_feature_key: string
          p_metadata?: Json
          p_reason: string
          p_request_id: string
          p_route: string
          p_user_id: string
        }
        Returns: {
          already_refunded: boolean
          app_credits_available: number
          app_credits_used: number
          period_key: string
        }[]
      }
      sync_organization_app_pool_recurring_addons: {
        Args: {
          p_items: Json
          p_organization_id: string
          p_subscription_status: string
        }
        Returns: number
      }
      sync_organization_portal_recurring_addons: {
        Args: {
          p_items: Json
          p_organization_id: string
          p_subscription_status: string
        }
        Returns: number
      }
      sync_organization_shared_app_credit_pool: {
        Args: { p_organization_id: string }
        Returns: number
      }
      sync_personal_app_entitlements: {
        Args: { p_user_id?: string }
        Returns: {
          addon_allocation: number
          available_credits: number
          effective_tier: string
          ledger_id: string
          monthly_allocation: number
          one_time_top_up_balance: number
          period_key: string
          recurring_addon_allocation: number
          used_credits: number
        }[]
      }
      update_managed_organization_group: {
        Args: {
          p_description?: string
          p_group_id: string
          p_name: string
          p_organization_id: string
          p_parent_group_id?: string
        }
        Returns: undefined
      }
      update_organization_settings: {
        Args: {
          p_manager_portal_access_mode: string
          p_mission_statement: string
          p_organization_id: string
          p_organization_name: string
          p_values_statement: string
          p_vision_statement: string
        }
        Returns: {
          manager_portal_access_mode: string
          mission_statement: string
          organization_name: string
          values_statement: string
          vision_statement: string
        }[]
      }
      update_organization_user: {
        Args: {
          p_billing_access_enabled: boolean
          p_is_active: boolean
          p_is_billable: boolean
          p_manager_portal_access_enabled: boolean
          p_organization_id: string
          p_organization_user_id: string
          p_primary_group_id: string
          p_role: string
        }
        Returns: {
          available_seat_count: number
          is_active: boolean
          is_billable: boolean
          manager_portal_access_enabled: boolean
          organization_role: string
          organization_user_id: string
          primary_group_id: string
          primary_group_name: string
          purchased_seat_count: number
          used_seat_count: number
          user_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
