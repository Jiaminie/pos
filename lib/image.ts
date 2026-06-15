import imageCompression from 'browser-image-compression';
import { toast } from 'sonner';

export async function compressProductImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 1.8, // Slightly below 2MB to ensure it fits comfortably
    maxWidthOrHeight: 1280, // Reasonable max dimension for product images
    useWebWorker: true,
  };

  try {
    return await imageCompression(file, options);
  } catch (error) {
    console.error('Image compression failed:', error);
    toast.error('Failed to optimize image, uploading original.');
    return file; // Fallback to original file
  }
}
