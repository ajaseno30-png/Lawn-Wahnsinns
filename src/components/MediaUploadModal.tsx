import React, { useRef } from 'react';
import { TrackMeta, SpotifyTheme } from '../types/lyrics';
import {
  X,
  Music,
  Video,
  FileAudio,
  FileVideo,
  Upload,
  Check,
  Disc,
  Palette,
  Sparkles
} from 'lucide-react';

interface MediaUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackMeta: TrackMeta;
  onUpdateTrackMeta: (meta: TrackMeta) => void;
  onUploadAudioFile: (file: File) => void;
  onUploadVideoFile: (file: File) => void;
  onResetToDefaultCanvas: () => void;
  selectedTheme: SpotifyTheme;
  onSelectTheme: (theme: SpotifyTheme) => void;
}

export const MediaUploadModal: React.FC<MediaUploadModalProps> = ({
  isOpen,
  onClose,
  trackMeta,
  onUpdateTrackMeta,
  onUploadAudioFile,
  onUploadVideoFile,
  onResetToDefaultCanvas,
  selectedTheme,
  onSelectTheme,
}) => {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadAudioFile(e.target.files[0]);
    }
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadVideoFile(e.target.files[0]);
    }
  };

  const themes: { id: SpotifyTheme; name: string; color: string }[] = [
    { id: 'emerald', name: 'Spotify Emerald', color: '#1DB954' },
    { id: 'cool_gray', name: 'Abu-Abu Keren', color: '#cbd5e1' },
    { id: 'purple_orchid', name: 'Dark Purple Orchid', color: '#c084fc' },
    { id: 'gold_kamboja', name: 'Gold Dark Kamboja', color: '#fbbf24' },
    { id: 'pink_sakura', name: 'Pink Blossom Sakura', color: '#f472b6' },
    { id: 'red_amaranth', name: 'Red Amaranth', color: '#f43f5e' },
    { id: 'green_poison', name: 'Green Poison', color: '#22c55e' },
    { id: 'dark_tree_brown', name: 'Dark Tree Brown', color: '#b45309' },
    { id: 'charcoal', name: 'Midnight Charcoal', color: '#27272a' },
    { id: 'midnight', name: 'Onyx Black', color: '#09090b' },
    { id: 'indigo', name: 'Deep Indigo', color: '#4338ca' },
    { id: 'amber', name: 'Chiaroscuro Amber', color: '#d97706' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-5 sm:p-6 space-y-6 text-neutral-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1db954]/20 text-[#1db954] flex items-center justify-center font-bold">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                Bahan Audio & Video
              </h3>
              <p className="text-xs text-neutral-400">
                Unggah file musik & video lirikmu untuk tampilan Spotify
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Buttons Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Audio Upload */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
              <FileAudio className="w-4 h-4 text-[#1db954]" />
              <span>File Audio Lagu</span>
            </div>

            <input
              type="file"
              ref={audioInputRef}
              accept="audio/*"
              className="hidden"
              onChange={handleAudioChange}
            />

            <div className="text-xs text-neutral-400 truncate">
              {trackMeta.audioFileName ? (
                <span className="text-white font-medium flex items-center gap-1.5 truncate">
                  <Check className="w-3.5 h-3.5 text-[#1db954] shrink-0" />
                  <span className="truncate">{trackMeta.audioFileName}</span>
                </span>
              ) : (
                <span>Audio bawaan demo aktif (Melodi Piano Lofi)</span>
              )}
            </div>

            <button
              onClick={() => audioInputRef.current?.click()}
              className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Music className="w-3.5 h-3.5" />
              Pilih Audio (.mp3, .wav, .m4a)
            </button>
          </div>

          {/* Video Upload */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
              <FileVideo className="w-4 h-4 text-blue-400" />
              <span>File Video Canvas (9:16)</span>
            </div>

            <input
              type="file"
              ref={videoInputRef}
              accept="video/*"
              className="hidden"
              onChange={handleVideoChange}
            />

            <div className="text-xs text-neutral-400 truncate">
              {trackMeta.videoFileName ? (
                <span className="text-white font-medium flex items-center gap-1.5 truncate">
                  <Check className="w-3.5 h-3.5 text-[#1db954] shrink-0" />
                  <span className="truncate">{trackMeta.videoFileName}</span>
                </span>
              ) : (
                <span>Video bawaan: Kanvas Lukisan Minyak Impasto 9:16</span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                Pilih Video (.mp4, .webm)
              </button>
              {trackMeta.videoUrl && (
                <button
                  onClick={onResetToDefaultCanvas}
                  title="Kembalikan ke kanvas lukisan impasto 9:16"
                  className="px-2.5 py-2 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded-lg text-xs"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Metadata Inputs */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
            <Disc className="w-3.5 h-3.5 text-[#1db954]" />
            Informasi Lagu (Tampilan Spotify)
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="text-neutral-400 font-medium">Judul Lagu</label>
              <input
                type="text"
                value={trackMeta.title}
                onChange={(e) =>
                  onUpdateTrackMeta({ ...trackMeta, title: e.target.value })
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-medium focus:border-[#1db954] focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-neutral-400 font-medium">Nama Artis / Penyanyi</label>
              <input
                type="text"
                value={trackMeta.artist}
                onChange={(e) =>
                  onUpdateTrackMeta({ ...trackMeta, artist: e.target.value })
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-medium focus:border-[#1db954] focus:outline-none"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-neutral-400 font-medium">Nama Album / Playlist Spotify</label>
              <input
                type="text"
                value={trackMeta.album}
                onChange={(e) =>
                  onUpdateTrackMeta({ ...trackMeta, album: e.target.value })
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white font-medium focus:border-[#1db954] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Spotify Theme Color */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-[#1db954]" />
            Aksen Warna Tema Spotify
          </label>
          <div className="flex flex-wrap gap-2">
            {themes.map((th) => (
              <button
                key={th.id}
                onClick={() => onSelectTheme(th.id)}
                className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 border transition-all ${
                  selectedTheme === th.id
                    ? 'border-white bg-neutral-800 text-white shadow-md'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: th.color }}
                />
                <span>{th.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#1db954] hover:bg-[#1ed760] text-black font-bold text-xs rounded-xl shadow-lg shadow-[#1db954]/20 transition-transform active:scale-95"
          >
            Selesai & Lanjutkan
          </button>
        </div>
      </div>
    </div>
  );
};
