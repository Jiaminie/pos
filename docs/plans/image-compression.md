# Plan: Implement Client-Side Image Compression

## Objective
Implement client-side image compression to ensure high-resolution photos taken on mobile devices fit within the existing 2MB upload limit, improving user experience and reducing upload times.

## Background
The current POS system has a 2MB server-side limit for product image uploads. High-resolution mobile photos frequently exceed this limit, leading to upload failures and a poor user experience.

## Implementation Steps
1.  **Dependencies:** Install `browser-image-compression`.
2.  **Compression Utility:** Create a helper function in a new or existing utility file to handle the compression logic.
3.  **UI Integration:** Update `components/products/ProductImageField.tsx` to utilize the compression utility before calling the upload API.
4.  **Error Handling:** Ensure that compression errors are caught and communicated to the user.

## Verification
-   **Test Case 1:** Upload a photo > 2MB on a mobile device and verify it is compressed and uploaded successfully.
-   **Test Case 2:** Verify that the image quality remains acceptable for product display after compression.
-   **Test Case 3:** Verify that valid images already under 2MB are handled correctly without unnecessary degradation.
