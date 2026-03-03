import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { YouTubeUploadProgress, YouTubeVideoMetadata } from '../types/electron';

export const youtubeQueryKeys = {
  authStatus: ['youtube', 'auth-status'] as const,
};

function assertYouTubeApi() {
  if (!window.electronAPI?.youtube) {
    throw new Error('YouTube upload is not available');
  }
  return window.electronAPI.youtube;
}

export function isYouTubeAvailable() {
  return Boolean(window.electronAPI?.youtube);
}

export function useYouTubeAuthStatus() {
  const available = isYouTubeAvailable();
  return useQuery({
    queryKey: youtubeQueryKeys.authStatus,
    queryFn: async () => {
      const api = assertYouTubeApi();
      return api.isAuthenticated();
    },
    enabled: available,
  });
}

export function useYouTubeAuthenticate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const api = assertYouTubeApi();
      return api.authenticate();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeQueryKeys.authStatus });
    },
  });
}

export function useYouTubeLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const api = assertYouTubeApi();
      return api.logout();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: youtubeQueryKeys.authStatus });
    },
  });
}

export function useYouTubeUpload() {
  return useMutation({
    mutationFn: async (input: {
      filePath: string;
      metadata: YouTubeVideoMetadata;
      onProgress?: (progress: YouTubeUploadProgress) => void;
    }) => {
      const api = assertYouTubeApi();
      return api.uploadVideo(input.filePath, input.metadata, input.onProgress);
    },
  });
}
