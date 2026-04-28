import os
import time
import json
import logging
from typing import Dict, List, Optional, Tuple
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
import requests
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('admin_upload_test.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class AdminImageUploadTester:
    """Comprehensive tester for admin image upload functionality"""

    def __init__(self, base_url: str = "http://localhost:5173"):
        self.base_url = base_url
        self.driver: Optional[webdriver.Chrome] = None
        self.wait: Optional[WebDriverWait] = None
        self.test_results: Dict = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "tests": [],
            "errors": [],
            "summary": {}
        }

    def setup_driver(self) -> None:
        """Initialize Chrome driver with appropriate options"""
        try:
            chrome_options = Options()
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--window-size=1920,1080")

            # Allow file uploads
            chrome_options.add_argument("--allow-file-access-from-files")
            chrome_options.add_argument("--disable-web-security")

            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.wait = WebDriverWait(self.driver, 10)

            logger.info("Chrome driver initialized successfully")

        except Exception as e:
            logger.error(f"Failed to setup driver: {e}")
            raise

    def create_test_images(self) -> List[str]:
        """Create test images for upload testing"""
        test_images = []

        try:
            # Create test directory
            test_dir = Path("test_images")
            test_dir.mkdir(exist_ok=True)

            # Generate different types of test images
            image_configs = [
                {"name": "small_image.jpg", "size": (100, 100), "format": "JPEG"},
                {"name": "medium_image.png", "size": (800, 600), "format": "PNG"},
                {"name": "large_image.jpg", "size": (2000, 1500), "format": "JPEG"},
                {"name": "square_image.png", "size": (500, 500), "format": "PNG"},
            ]

            # Try to create images using PIL if available
            try:
                from PIL import Image, ImageDraw

                for config in image_configs:
                    img = Image.new('RGB', config["size"], color='red')
                    draw = ImageDraw.Draw(img)

                    # Add some content to make it a valid test image
                    draw.rectangle([10, 10, config["size"][0]-10, config["size"][1]-10],
                                 outline='blue', width=5)
                    draw.text((50, 50), f"Test Image\n{config['name']}", fill='white')

                    file_path = test_dir / config["name"]
                    img.save(file_path, format=config["format"])
                    test_images.append(str(file_path))

                logger.info(f"Created {len(test_images)} test images")

            except ImportError:
                logger.warning("PIL not available, using placeholder files")
                # Create placeholder files if PIL is not available
                for config in image_configs:
                    file_path = test_dir / config["name"]
                    with open(file_path, 'wb') as f:
                        # Create a minimal valid image file
                        f.write(b'\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xFF\xDB')
                    test_images.append(str(file_path))

        except Exception as e:
            logger.error(f"Failed to create test images: {e}")

        return test_images

    def login_as_admin(self) -> bool:
        """Login to the admin panel"""
        try:
            logger.info("Attempting admin login...")

            # Navigate to login page
            self.driver.get(f"{self.base_url}/login")

            # Wait for login form
            email_input = self.wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='email']"))
            )
            password_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='password']")

            # Use admin credentials (you may need to adjust these)
            admin_email = os.getenv("ADMIN_EMAIL", "admin@imaginethisprinted.com")
            admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

            email_input.send_keys(admin_email)
            password_input.send_keys(admin_password)

            # Submit login form
            login_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
            login_button.click()

            # Wait for redirect to dashboard
            self.wait.until(EC.url_contains("dashboard"))

            logger.info("Admin login successful")
            return True

        except TimeoutException:
            logger.error("Login timeout - check credentials or page structure")
            return False
        except Exception as e:
            logger.error(f"Login failed: {e}")
            return False

    def navigate_to_admin_upload(self) -> bool:
        """Navigate to admin image upload section"""
        try:
            logger.info("Navigating to admin upload section...")

            # Try different possible admin upload URLs
            upload_urls = [
                f"{self.base_url}/admin/products",
                f"{self.base_url}/admin/upload",
                f"{self.base_url}/admin/media",
                f"{self.base_url}/dashboard/admin"
            ]

            for url in upload_urls:
                try:
                    self.driver.get(url)
                    time.sleep(2)

                    # Look for upload-related elements
                    upload_elements = self.driver.find_elements(
                        By.CSS_SELECTOR,
                        "input[type='file'], [data-testid*='upload'], .upload-zone, .file-upload"
                    )

                    if upload_elements:
                        logger.info(f"Found upload interface at {url}")
                        return True

                except Exception:
                    continue

            # If direct URLs don't work, try to find upload through navigation
            try:
                # Look for admin menu items
                admin_links = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    "a[href*='admin'], a[href*='upload'], .nav-link, .menu-item"
                )

                for link in admin_links:
                    if any(keyword in link.text.lower() for keyword in ['upload', 'media', 'products', 'admin']):
                        link.click()
                        time.sleep(2)

                        upload_elements = self.driver.find_elements(
                            By.CSS_SELECTOR,
                            "input[type='file'], [data-testid*='upload']"
                        )

                        if upload_elements:
                            logger.info(f"Found upload interface via navigation")
                            return True

            except Exception as e:
                logger.error(f"Navigation attempt failed: {e}")

            logger.error("Could not find admin upload interface")
            return False

        except Exception as e:
            logger.error(f"Failed to navigate to upload section: {e}")
            return False

    def test_single_image_upload(self, image_path: str) -> Dict:
        """Test uploading a single image"""
        test_result = {
            "test": "single_image_upload",
            "image": image_path,
            "success": False,
            "errors": [],
            "details": {}
        }

        try:
            logger.info(f"Testing upload of {image_path}")

            # Find file input
            file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")

            # Upload the file
            file_input.send_keys(os.path.abspath(image_path))

            # Wait for upload to process
            time.sleep(3)

            # Look for success indicators
            success_indicators = [
                "upload successful",
                "image uploaded",
                "file uploaded",
                "success"
            ]

            page_text = self.driver.page_source.lower()
            upload_success = any(indicator in page_text for indicator in success_indicators)

            # Check for error messages
            error_indicators = [
                "error",
                "failed",
                "invalid",
                "too large",
                "not supported"
            ]

            upload_error = any(indicator in page_text for indicator in error_indicators)

            # Look for uploaded image in the interface
            uploaded_images = self.driver.find_elements(
                By.CSS_SELECTOR,
                "img[src*='blob:'], img[src*='data:'], .uploaded-image, .image-preview"
            )

            test_result["details"] = {
                "success_indicators_found": upload_success,
                "error_indicators_found": upload_error,
                "uploaded_images_count": len(uploaded_images),
                "page_contains_blob_urls": "blob:" in page_text
            }

            if upload_success or (uploaded_images and not upload_error):
                test_result["success"] = True
                logger.info(f"Upload of {image_path} appears successful")
            else:
                test_result["errors"].append("No success indicators found")
                logger.warning(f"Upload of {image_path} may have failed")

        except NoSuchElementException:
            error_msg = "File input element not found"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)
        except Exception as e:
            error_msg = f"Upload test failed: {e}"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)

        return test_result

    def test_multiple_image_upload(self, image_paths: List[str]) -> Dict:
        """Test uploading multiple images at once"""
        test_result = {
            "test": "multiple_image_upload",
            "images": image_paths,
            "success": False,
            "errors": [],
            "details": {}
        }

        try:
            logger.info(f"Testing multiple image upload: {len(image_paths)} files")

            # Find file input that supports multiple files
            file_inputs = self.driver.find_elements(By.CSS_SELECTOR, "input[type='file']")

            multiple_input = None
            for input_elem in file_inputs:
                if input_elem.get_attribute("multiple") is not None:
                    multiple_input = input_elem
                    break

            if not multiple_input:
                # Try the first file input even if it doesn't explicitly support multiple
                multiple_input = file_inputs[0] if file_inputs else None

            if not multiple_input:
                test_result["errors"].append("No file input found")
                return test_result

            # Upload multiple files
            file_paths_str = "\n".join([os.path.abspath(path) for path in image_paths])
            multiple_input.send_keys(file_paths_str)

            # Wait for uploads to process
            time.sleep(5)

            # Check results
            uploaded_images = self.driver.find_elements(
                By.CSS_SELECTOR,
                "img[src*='blob:'], img[src*='data:'], .uploaded-image, .image-preview"
            )

            test_result["details"] = {
                "uploaded_images_count": len(uploaded_images),
                "expected_count": len(image_paths),
                "multiple_attribute": multiple_input.get_attribute("multiple") is not None
            }

            if len(uploaded_images) >= len(image_paths):
                test_result["success"] = True
                logger.info("Multiple image upload appears successful")
            else:
                test_result["errors"].append(f"Expected {len(image_paths)} images, found {len(uploaded_images)}")

        except Exception as e:
            error_msg = f"Multiple upload test failed: {e}"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)

        return test_result

    def test_upload_validation(self) -> Dict:
        """Test upload validation (file types, sizes, etc.)"""
        test_result = {
            "test": "upload_validation",
            "success": False,
            "errors": [],
            "details": {}
        }

        try:
            logger.info("Testing upload validation")

            # Test invalid file type
            invalid_file = "test_invalid.txt"
            with open(invalid_file, 'w') as f:
                f.write("This is not an image")

            file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")
            file_input.send_keys(os.path.abspath(invalid_file))

            time.sleep(2)

            # Check for validation error
            page_text = self.driver.page_source.lower()
            validation_errors = [
                "invalid file type",
                "not supported",
                "only images",
                "invalid format"
            ]

            validation_found = any(error in page_text for error in validation_errors)

            test_result["details"] = {
                "validation_error_shown": validation_found,
                "page_source_length": len(page_text)
            }

            if validation_found:
                test_result["success"] = True
                logger.info("Upload validation working correctly")
            else:
                test_result["errors"].append("No validation error shown for invalid file")

            # Clean up
            os.remove(invalid_file)

        except Exception as e:
            error_msg = f"Validation test failed: {e}"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)

        return test_result

    def check_backend_storage(self) -> Dict:
        """Check if uploaded images are actually stored in the backend"""
        test_result = {
            "test": "backend_storage_check",
            "success": False,
            "errors": [],
            "details": {}
        }

        try:
            logger.info("Checking backend storage")

            # Try to find uploaded images in the page source
            page_source = self.driver.page_source

            # Look for image URLs that might indicate backend storage
            import re

            # Common patterns for stored images
            patterns = [
                r'https?://[^/]+/uploads/[^"\']+',
                r'https?://[^/]+/images/[^"\']+',
                r'https?://[^/]+/media/[^"\']+',
                r'blob:[^"\']+',
                r'data:image/[^"\']+',
            ]

            found_urls = []
            for pattern in patterns:
                matches = re.findall(pattern, page_source)
                found_urls.extend(matches)

            test_result["details"] = {
                "image_urls_found": len(found_urls),
                "url_patterns": found_urls[:5],  # First 5 URLs
                "has_blob_urls": any("blob:" in url for url in found_urls),
                "has_data_urls": any("data:" in url for url in found_urls),
                "has_http_urls": any(url.startswith("http") for url in found_urls)
            }

            # Test if we can access any found HTTP URLs
            accessible_urls = 0
            for url in found_urls:
                if url.startswith("http"):
                    try:
                        response = requests.head(url, timeout=5)
                        if response.status_code == 200:
                            accessible_urls += 1
                    except:
                        pass

            test_result["details"]["accessible_urls"] = accessible_urls

            if found_urls:
                test_result["success"] = True
                logger.info(f"Found {len(found_urls)} image URLs")
            else:
                test_result["errors"].append("No image URLs found in page")

        except Exception as e:
            error_msg = f"Backend storage check failed: {e}"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)

        return test_result

    def capture_network_activity(self) -> Dict:
        """Capture network activity during upload"""
        test_result = {
            "test": "network_activity",
            "success": False,
            "errors": [],
            "details": {}
        }

        try:
            logger.info("Capturing network activity")

            # Enable logging
            self.driver.execute_cdp_cmd('Network.enable', {})

            # Clear existing logs
            self.driver.get_log('performance')

            # Perform a test upload
            test_images = self.create_test_images()
            if test_images:
                file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")
                file_input.send_keys(os.path.abspath(test_images[0]))
                time.sleep(3)

            # Get network logs
            logs = self.driver.get_log('performance')

            upload_requests = []
            for log in logs:
                message = json.loads(log['message'])
                if message['message']['method'] == 'Network.requestWillBeSent':
                    url = message['message']['params']['request']['url']
                    method = message['message']['params']['request']['method']

                    if method == 'POST' and any(keyword in url.lower() for keyword in ['upload', 'image', 'file']):
                        upload_requests.append({
                            'url': url,
                            'method': method,
                            'timestamp': log['timestamp']
                        })

            test_result["details"] = {
                "total_network_events": len(logs),
                "upload_requests": upload_requests,
                "upload_request_count": len(upload_requests)
            }

            if upload_requests:
                test_result["success"] = True
                logger.info(f"Captured {len(upload_requests)} upload requests")
            else:
                test_result["errors"].append("No upload requests detected")

        except Exception as e:
            error_msg = f"Network capture failed: {e}"
            test_result["errors"].append(error_msg)
            logger.error(error_msg)

        return test_result

    def run_full_test_suite(self) -> Dict:
        """Run the complete test suite"""
        logger.info("Starting full admin image upload test suite")

        try:
            # Setup
            self.setup_driver()

            # Create test images
            test_images = self.create_test_images()
            if not test_images:
                raise Exception("Failed to create test images")

            # Login as admin
            if not self.login_as_admin():
                raise Exception("Failed to login as admin")

            # Navigate to upload section
            if not self.navigate_to_admin_upload():
                raise Exception("Failed to find admin upload interface")

            # Run individual tests
            self.test_results["tests"].append(self.test_single_image_upload(test_images[0]))

            if len(test_images) > 1:
                self.test_results["tests"].append(self.test_multiple_image_upload(test_images[:2]))

            self.test_results["tests"].append(self.test_upload_validation())
            self.test_results["tests"].append(self.check_backend_storage())
            self.test_results["tests"].append(self.capture_network_activity())

            # Generate summary
            successful_tests = sum(1 for test in self.test_results["tests"] if test["success"])
            total_tests = len(self.test_results["tests"])

            self.test_results["summary"] = {
                "total_tests": total_tests,
                "successful_tests": successful_tests,
                "failed_tests": total_tests - successful_tests,
                "success_rate": f"{(successful_tests/total_tests)*100:.1f}%" if total_tests > 0 else "0%"
            }

            logger.info(f"Test suite completed: {successful_tests}/{total_tests} tests passed")

        except Exception as e:
            error_msg = f"Test suite failed: {e}"
            self.test_results["errors"].append(error_msg)
            logger.error(error_msg)

        finally:
            if self.driver:
                self.driver.quit()

        return self.test_results

    def save_results(self, filename: str = "admin_upload_test_results.json") -> None:
        """Save test results to file"""
        try:
            with open(filename, 'w') as f:
                json.dump(self.test_results, f, indent=2)
            logger.info(f"Test results saved to {filename}")
        except Exception as e:
            logger.error(f"Failed to save results: {e}")

def main():
    """Main execution function"""
    # Configuration
    BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:5173")

    # Initialize tester
    tester = AdminImageUploadTester(BASE_URL)

    try:
        # Run tests
        results = tester.run_full_test_suite()

        # Save results
        tester.save_results()

        # Print summary
        print("\n" + "="*50)
        print("ADMIN IMAGE UPLOAD TEST RESULTS")
        print("="*50)
        print(f"Total Tests: {results['summary'].get('total_tests', 0)}")
        print(f"Successful: {results['summary'].get('successful_tests', 0)}")
        print(f"Failed: {results['summary'].get('failed_tests', 0)}")
        print(f"Success Rate: {results['summary'].get('success_rate', '0%')}")

        if results.get("errors"):
            print(f"\nGlobal Errors: {len(results['errors'])}")
            for error in results["errors"]:
                print(f"  - {error}")

        print("\nDetailed Results:")
        for test in results.get("tests", []):
            status = "PASS" if test["success"] else "FAIL"
            print(f"  {status} {test['test']}")
            if test["errors"]:
                for error in test["errors"]:
                    print(f"    Error: {error}")

        print(f"\nFull results saved to: admin_upload_test_results.json")
        print(f"Logs saved to: admin_upload_test.log")

    except KeyboardInterrupt:
        print("\nTest interrupted by user")
    except Exception as e:
        print(f"\nTest execution failed: {e}")
        logger.error(f"Main execution failed: {e}")

if __name__ == "__main__":
    main()
