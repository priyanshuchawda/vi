import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TranscriptionPanel from '../../src/components/ui/TranscriptionPanel';
import { useProjectStore } from '../../src/stores/useProjectStore';

// Mock the store
vi.mock('../../src/stores/useProjectStore');

describe('TranscriptionPanel Component', () => {
  const mockClearTranscription = vi.fn();
  const mockSetCurrentTime = vi.fn();
  const mockSetNotification = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    
    // Default mock implementation
    (useProjectStore as any).mockReturnValue({
      transcription: null,
      isTranscribing: false,
      transcriptionProgress: null,
      clearTranscription: mockClearTranscription,
      setCurrentTime: mockSetCurrentTime,
      setNotification: mockSetNotification,
    });
  });

  describe('Rendering', () => {
    it('should not render when no transcription exists', () => {
      const { container } = render(<TranscriptionPanel />);
      expect(container.firstChild).toBeNull();
    });

    it('should render when transcription exists', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Test transcription text',
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      expect(screen.getByText('Transcription')).toBeInTheDocument();
    });

    it('should render when transcribing is in progress', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: null,
        isTranscribing: true,
        transcriptionProgress: { status: 'Processing...', progress: 50 },
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      expect(screen.getByText('Transcription')).toBeInTheDocument();
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });
  });

  describe('Progress Indicator', () => {
    it('should show progress bar when transcribing', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: null,
        isTranscribing: true,
        transcriptionProgress: {
          status: 'Transcribing...',
          progress: 75
        },
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      expect(screen.getByText('Transcribing...')).toBeInTheDocument();
      
      // Check for progress bar (it should have width style)
      const progressBar = document.querySelector('[style*="width: 75%"]');
      expect(progressBar).toBeInTheDocument();
    });

    it('should show clip number when available', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: null,
        isTranscribing: true,
        transcriptionProgress: {
          status: 'Processing clip',
          progress: 50,
          clip: 2
        },
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      expect(screen.getByText(/Clip 2/i)).toBeInTheDocument();
    });
  });

  describe('Transcription Display', () => {
    it('should display full text in textarea', () => {
      const transcriptionText = 'This is the full transcription text';
      
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: transcriptionText,
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const textarea = screen.getByDisplayValue(transcriptionText);
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('readonly');
    });

    it('should display segments when available and segment view is active', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Full text',
          segments: [
            { id: 1, start: 0, end: 2, text: 'Hello world' },
            { id: 2, start: 2, end: 4, text: 'This is a test' }
          ]
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      expect(screen.getByText('Hello world')).toBeInTheDocument();
      expect(screen.getByText('This is a test')).toBeInTheDocument();
    });

    it('should allow toggling between segments and full text view', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Full transcription text',
          segments: [
            { id: 1, start: 0, end: 2, text: 'Segment text' }
          ]
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      // Initially shows segments
      expect(screen.getByText('Segment text')).toBeInTheDocument();
      
      // Click toggle button
      const toggleButton = screen.getByTitle('Toggle view');
      fireEvent.click(toggleButton);
      
      // Should now show full text view
      expect(screen.getByDisplayValue('Full transcription text')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('should close panel when close button is clicked', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Test',
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const closeButton = screen.getByTitle('Close transcription');
      fireEvent.click(closeButton);
      
      expect(mockClearTranscription).toHaveBeenCalled();
    });

    it('should copy text to clipboard when copy button is clicked', async () => {
      const transcriptionText = 'Text to copy';
      
      // Mock clipboard
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: transcriptionText,
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const copyButton = screen.getByTitle('Copy to clipboard');
      fireEvent.click(copyButton);
      
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(transcriptionText);
        expect(mockSetNotification).toHaveBeenCalledWith({
          type: 'success',
          message: 'Transcription copied to clipboard!'
        });
      });
    });

    it('should jump to time when segment is clicked', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Full text',
          segments: [
            { id: 1, start: 5.5, end: 8.2, text: 'Clickable segment' }
          ]
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const segment = screen.getByText('Clickable segment');
      fireEvent.click(segment.closest('div')!);
      
      expect(mockSetCurrentTime).toHaveBeenCalledWith(5.5);
    });
  });

  describe('Export Functionality', () => {
    it('should export as TXT file', () => {
      const transcriptionText = 'Export this text';
      
      // Mock URL and link creation
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
      
      const mockClick = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mockClick);

      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: transcriptionText,
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const exportButton = screen.getByTitle('Export as text file');
      fireEvent.click(exportButton);
      
      expect(mockClick).toHaveBeenCalled();
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it('should export as SRT file when segments are available', () => {
      // Mock URL and link creation
      global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
      
      const mockClick = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(mockClick);

      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Full text',
          segments: [
            { id: 1, start: 0, end: 2, text: 'First segment' },
            { id: 2, start: 2, end: 4, text: 'Second segment' }
          ]
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const srtButton = screen.getByTitle('Export as SRT subtitle file');
      fireEvent.click(srtButton);
      
      expect(mockClick).toHaveBeenCalled();
      expect(mockSetNotification).toHaveBeenCalledWith({
        type: 'success',
        message: 'SRT file exported!'
      });
    });

    it('should show error when trying to export SRT without segments', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Text without segments',
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      // SRT button should not be visible without segments
      const srtButton = screen.queryByTitle('Export as SRT subtitle file');
      expect(srtButton).not.toBeInTheDocument();
    });
  });

  describe('Statistics', () => {
    it('should display correct word and character count', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Hello world test',
          segments: []
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      // Should show 3 words
      expect(screen.getByText('3')).toBeInTheDocument();
      // Should show character count (16 characters)
      expect(screen.getByText('16')).toBeInTheDocument();
    });

    it('should display segment count when segments exist', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: {
          text: 'Text with segments',
          segments: [
            { id: 1, start: 0, end: 1, text: 'Segment 1' },
            { id: 2, start: 1, end: 2, text: 'Segment 2' },
            { id: 3, start: 2, end: 3, text: 'Segment 3' }
          ]
        },
        isTranscribing: false,
        transcriptionProgress: null,
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const segmentsRow = screen.getByText(/Segments:/i).closest('div');
      expect(segmentsRow).toHaveTextContent('Segments:');
      expect(segmentsRow).toHaveTextContent('3');
    });
  });

  describe('Disabled State', () => {
    it('should disable close button while transcribing', () => {
      (useProjectStore as any).mockReturnValue({
        transcription: null,
        isTranscribing: true,
        transcriptionProgress: { status: 'Processing...', progress: 30 },
        clearTranscription: mockClearTranscription,
        setCurrentTime: mockSetCurrentTime,
        setNotification: mockSetNotification,
      });

      render(<TranscriptionPanel />);
      
      const closeButton = screen.getByTitle('Close transcription');
      expect(closeButton).toBeDisabled();
    });
  });
});
