export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      guest_sessions: {
        Row: {
          id: string;
          host_device_id: string;
          status: "active" | "ended";
          display_mode: "mirror" | "complementary";
          seq: number;
          created_at: string;
          updated_at: string;
          expires_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          host_device_id: string;
          status?: "active" | "ended";
          display_mode?: "mirror" | "complementary";
          seq?: number;
          created_at?: string;
          updated_at?: string;
          expires_at: string;
          closed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["guest_sessions"]["Insert"]>;
      };
      session_devices: {
        Row: {
          id: string;
          session_id: string;
          device_id: string;
          role: "controller" | "display" | "combined";
          label: string | null;
          display_mode: "mirror" | "complementary";
          last_seen_at: string;
          is_online: boolean;
        };
        Insert: {
          id?: string;
          session_id: string;
          device_id: string;
          role: "controller" | "display" | "combined";
          label?: string | null;
          display_mode?: "mirror" | "complementary";
          last_seen_at?: string;
          is_online?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["session_devices"]["Insert"]>;
      };
      pairing_codes: {
        Row: {
          id: string;
          session_id: string;
          code_hash: string;
          code_hint: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          code_hash: string;
          code_hint: string;
          attempts?: number;
          max_attempts?: number;
          expires_at: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pairing_codes"]["Insert"]>;
      };
      playback_state: {
        Row: {
          session_id: string;
          audio_mode: string;
          is_playing: boolean;
          position_ms: number;
          rate: number;
          track_id: string;
          seq: number;
          updated_at: string;
        };
        Insert: {
          session_id: string;
          audio_mode?: string;
          is_playing?: boolean;
          position_ms?: number;
          rate?: number;
          track_id?: string;
          seq?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["playback_state"]["Insert"]>;
      };
      active_preset_snapshots: {
        Row: {
          session_id: string;
          visualizer_id: string;
          quality_tier: string;
          preset_id: string | null;
          params: Json;
          seq: number;
          updated_at: string;
        };
        Insert: {
          session_id: string;
          visualizer_id: string;
          quality_tier?: string;
          preset_id?: string | null;
          params?: Json;
          seq?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["active_preset_snapshots"]["Insert"]>;
      };
      presets: {
        Row: {
          id: string;
          owner_user_id: string | null;
          name: string;
          visualizer_id: string;
          params: Json;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id?: string | null;
          name: string;
          visualizer_id: string;
          params?: Json;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["presets"]["Insert"]>;
      };
    };
  };
};
