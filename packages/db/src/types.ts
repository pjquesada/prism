export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableDef<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown> = Partial<Insert>,
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<
        {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      guest_sessions: TableDef<
        {
          id: string;
          host_device_id: string;
          status: "active" | "ended";
          display_mode: "mirror" | "complementary";
          seq: number;
          created_at: string;
          updated_at: string;
          expires_at: string;
          closed_at: string | null;
        },
        {
          id?: string;
          host_device_id: string;
          status?: "active" | "ended";
          display_mode?: "mirror" | "complementary";
          seq?: number;
          created_at?: string;
          updated_at?: string;
          expires_at: string;
          closed_at?: string | null;
        }
      >;
      session_devices: TableDef<
        {
          id: string;
          session_id: string;
          device_id: string;
          role: "controller" | "display" | "combined";
          label: string | null;
          display_mode: "mirror" | "complementary";
          last_seen_at: string;
          is_online: boolean;
        },
        {
          id?: string;
          session_id: string;
          device_id: string;
          role: "controller" | "display" | "combined";
          label?: string | null;
          display_mode?: "mirror" | "complementary";
          last_seen_at?: string;
          is_online?: boolean;
        }
      >;
      pairing_codes: TableDef<
        {
          id: string;
          session_id: string;
          code_hash: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
          consumed_at: string | null;
          revoked_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          session_id: string;
          code_hash: string;
          attempts?: number;
          max_attempts?: number;
          expires_at: string;
          consumed_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        }
      >;
      session_credentials: TableDef<
        {
          session_id: string;
          device_id: string;
          secret_hash: string;
          role: "controller" | "display" | "combined";
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        },
        {
          session_id: string;
          device_id: string;
          secret_hash: string;
          role: "controller" | "display" | "combined";
          expires_at: string;
          revoked_at?: string | null;
          created_at?: string;
        }
      >;
      playback_state: TableDef<
        {
          session_id: string;
          audio_mode: string;
          is_playing: boolean;
          position_ms: number;
          rate: number;
          track_id: string;
          seq: number;
          updated_at: string;
        },
        {
          session_id: string;
          audio_mode?: string;
          is_playing?: boolean;
          position_ms?: number;
          rate?: number;
          track_id?: string;
          seq?: number;
          updated_at?: string;
        }
      >;
      active_preset_snapshots: TableDef<
        {
          session_id: string;
          visualizer_id: string;
          quality_tier: string;
          preset_id: string | null;
          params: Json;
          seq: number;
          updated_at: string;
        },
        {
          session_id: string;
          visualizer_id: string;
          quality_tier?: string;
          preset_id?: string | null;
          params?: Json;
          seq?: number;
          updated_at?: string;
        }
      >;
      presets: TableDef<
        {
          id: string;
          owner_user_id: string | null;
          name: string;
          visualizer_id: string;
          params: Json;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          owner_user_id?: string | null;
          name: string;
          visualizer_id: string;
          params?: Json;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
