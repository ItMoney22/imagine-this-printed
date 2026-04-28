import os
import sys
import asyncio
import aiohttp
import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, timezone
from google.cloud import storage
from google.auth import default
import logging
from pathlib import Path

# Configure logging with UTF-8 encoding for Windows compatibility
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
# Set stdout encoding for Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
logger = logging.getLogger(__name__)

# ASCII-friendly status icons for Windows console compatibility
CHECK = "[OK]"
CROSS = "[X]"

class ImageStorageVerifier:
    """Verifies image storage pipeline integrity and URL accessibility"""

    def __init__(self, bucket_name: str, project_id: Optional[str] = None):
        self.bucket_name = bucket_name
        self.project_id = project_id
        self.client = None
        self.bucket = None
        self.session = None

    async def __aenter__(self):
        """Async context manager entry"""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.cleanup()

    async def initialize(self) -> None:
        """Initialize GCS client and HTTP session"""
        try:
            # Initialize GCS client
            credentials, project = default()
            self.client = storage.Client(
                credentials=credentials,
                project=self.project_id or project
            )
            self.bucket = self.client.bucket(self.bucket_name)

            # Initialize HTTP session
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30)
            )

            logger.info(f"Initialized GCS client for bucket: {self.bucket_name}")

        except Exception as e:
            logger.error(f"Failed to initialize: {e}")
            raise

    async def cleanup(self) -> None:
        """Clean up resources"""
        if self.session:
            await self.session.close()

    def verify_bucket_exists(self) -> bool:
        """Verify that the GCS bucket exists and is accessible"""
        try:
            self.bucket.reload()
            logger.info(f"{CHECK} Bucket '{self.bucket_name}' exists and is accessible")
            return True
        except Exception as e:
            logger.error(f"{CROSS} Bucket verification failed: {e}")
            return False

    def check_bucket_permissions(self) -> Dict[str, bool]:
        """Check bucket permissions for common operations"""
        permissions = {
            'read': False,
            'write': False,
            'delete': False
        }

        try:
            # Test read permission
            list(self.bucket.list_blobs(max_results=1))
            permissions['read'] = True
            logger.info(f"{CHECK} Read permission verified")

            # Test write permission with a test file
            test_blob = self.bucket.blob('test-permissions.txt')
            test_blob.upload_from_string('test content')
            permissions['write'] = True
            logger.info(f"{CHECK} Write permission verified")

            # Test delete permission
            test_blob.delete()
            permissions['delete'] = True
            logger.info(f"{CHECK} Delete permission verified")

        except Exception as e:
            logger.error(f"Permission check failed: {e}")

        return permissions

    def get_recent_uploads(self, hours: int = 24) -> List[storage.Blob]:
        """Get recently uploaded images"""
        cutoff_time = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
        recent_blobs = []

        try:
            for blob in self.bucket.list_blobs():
                if blob.time_created and blob.time_created.replace(tzinfo=None) > cutoff_time:
                    # Filter for image files
                    if blob.content_type and blob.content_type.startswith('image/'):
                        recent_blobs.append(blob)

            logger.info(f"Found {len(recent_blobs)} recent image uploads")
            return recent_blobs

        except Exception as e:
            logger.error(f"Failed to get recent uploads: {e}")
            return []

    async def verify_url_accessibility(self, url: str) -> Tuple[bool, int, str]:
        """Verify that an image URL is accessible"""
        try:
            async with self.session.get(url) as response:
                is_accessible = response.status == 200
                content_type = response.headers.get('content-type', '')

                if is_accessible and not content_type.startswith('image/'):
                    logger.warning(f"URL accessible but not an image: {content_type}")

                return is_accessible, response.status, content_type

        except Exception as e:
            logger.error(f"URL check failed for {url}: {e}")
            return False, 0, str(e)

    async def batch_verify_urls(self, urls: List[str]) -> Dict[str, Dict]:
        """Verify multiple URLs concurrently"""
        results = {}

        async def verify_single_url(url: str) -> None:
            accessible, status, content_type = await self.verify_url_accessibility(url)
            results[url] = {
                'accessible': accessible,
                'status_code': status,
                'content_type': content_type,
                'is_image': content_type.startswith('image/') if accessible else False
            }

        # Process URLs in batches to avoid overwhelming the server
        batch_size = 10
        for i in range(0, len(urls), batch_size):
            batch = urls[i:i + batch_size]
            tasks = [verify_single_url(url) for url in batch]
            await asyncio.gather(*tasks, return_exceptions=True)

        return results

    def check_storage_structure(self) -> Dict[str, List[str]]:
        """Check the storage folder structure"""
        structure = {
            'products': [],
            'designs': [],
            'models': [],
            'avatars': [],
            'other': []
        }

        try:
            for blob in self.bucket.list_blobs():
                path_parts = blob.name.split('/')

                if len(path_parts) > 1:
                    folder = path_parts[0]
                    if folder in structure:
                        structure[folder].append(blob.name)
                    else:
                        structure['other'].append(blob.name)
                else:
                    structure['other'].append(blob.name)

            # Log structure summary
            for folder, files in structure.items():
                logger.info(f"Folder '{folder}': {len(files)} files")

        except Exception as e:
            logger.error(f"Failed to check storage structure: {e}")

        return structure

    def verify_image_metadata(self, blob: storage.Blob) -> Dict:
        """Verify image metadata and properties"""
        metadata = {
            'name': blob.name,
            'size': blob.size,
            'content_type': blob.content_type,
            'created': blob.time_created,
            'updated': blob.updated,
            'public_url': blob.public_url,
            'metadata': blob.metadata or {},
            'cache_control': blob.cache_control,
            'issues': []
        }

        # Check for common issues
        if not blob.content_type or not blob.content_type.startswith('image/'):
            metadata['issues'].append('Invalid or missing content type')

        if blob.size and blob.size > 10 * 1024 * 1024:  # 10MB
            metadata['issues'].append('File size exceeds 10MB')

        if not blob.cache_control:
            metadata['issues'].append('No cache control headers')

        return metadata

    async def run_comprehensive_check(self) -> Dict:
        """Run a comprehensive check of the image storage pipeline"""
        logger.info("Starting comprehensive image storage verification...")

        results = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'bucket_name': self.bucket_name,
            'bucket_exists': False,
            'permissions': {},
            'recent_uploads': [],
            'url_verification': {},
            'storage_structure': {},
            'metadata_issues': [],
            'summary': {
                'total_files': 0,
                'accessible_urls': 0,
                'failed_urls': 0,
                'metadata_issues': 0
            }
        }

        # 1. Verify bucket exists
        results['bucket_exists'] = self.verify_bucket_exists()
        if not results['bucket_exists']:
            return results

        # 2. Check permissions
        results['permissions'] = self.check_bucket_permissions()

        # 3. Get recent uploads
        recent_blobs = self.get_recent_uploads(hours=24)
        results['recent_uploads'] = [blob.name for blob in recent_blobs]

        # 4. Check storage structure
        results['storage_structure'] = self.check_storage_structure()

        # 5. Verify URLs for recent uploads
        if recent_blobs:
            urls = [blob.public_url for blob in recent_blobs[:20]]  # Limit to 20 for testing
            results['url_verification'] = await self.batch_verify_urls(urls)

            # Count accessible vs failed URLs
            for url_data in results['url_verification'].values():
                if url_data['accessible']:
                    results['summary']['accessible_urls'] += 1
                else:
                    results['summary']['failed_urls'] += 1

        # 6. Check metadata for issues
        for blob in recent_blobs[:10]:  # Check first 10 recent uploads
            metadata = self.verify_image_metadata(blob)
            if metadata['issues']:
                results['metadata_issues'].append(metadata)
                results['summary']['metadata_issues'] += len(metadata['issues'])

        # 7. Calculate summary
        results['summary']['total_files'] = sum(
            len(files) for files in results['storage_structure'].values()
        )

        logger.info("Comprehensive check completed")
        return results

    def generate_report(self, results: Dict) -> str:
        """Generate a human-readable report"""
        report = []
        report.append("=" * 60)
        report.append("IMAGE STORAGE PIPELINE VERIFICATION REPORT")
        report.append("=" * 60)
        report.append(f"Generated: {results['timestamp']}")
        report.append(f"Bucket: {results['bucket_name']}")
        report.append("")

        # Bucket status
        report.append("BUCKET STATUS:")
        report.append(f"  {CHECK} Exists: {results['bucket_exists']}")
        if results['permissions']:
            report.append("  Permissions:")
            for perm, status in results['permissions'].items():
                status_icon = CHECK if status else CROSS
                report.append(f"    {status_icon} {perm.capitalize()}: {status}")
        report.append("")

        # Storage structure
        report.append("STORAGE STRUCTURE:")
        for folder, files in results['storage_structure'].items():
            report.append(f"  {folder}/: {len(files)} files")
        report.append("")

        # Recent uploads
        report.append(f"RECENT UPLOADS (last 24h): {len(results['recent_uploads'])}")
        for upload in results['recent_uploads'][:5]:  # Show first 5
            report.append(f"  - {upload}")
        if len(results['recent_uploads']) > 5:
            report.append(f"  ... and {len(results['recent_uploads']) - 5} more")
        report.append("")

        # URL verification
        if results['url_verification']:
            report.append("URL ACCESSIBILITY:")
            accessible = results['summary']['accessible_urls']
            failed = results['summary']['failed_urls']
            total = accessible + failed
            report.append(f"  {CHECK} Accessible: {accessible}/{total}")
            report.append(f"  {CROSS} Failed: {failed}/{total}")

            # Show failed URLs
            failed_urls = [
                url for url, data in results['url_verification'].items()
                if not data['accessible']
            ]
            if failed_urls:
                report.append("  Failed URLs:")
                for url in failed_urls[:3]:  # Show first 3
                    report.append(f"    - {url}")
        report.append("")

        # Metadata issues
        if results['metadata_issues']:
            report.append("METADATA ISSUES:")
            for issue_data in results['metadata_issues'][:3]:  # Show first 3
                report.append(f"  File: {issue_data['name']}")
                for issue in issue_data['issues']:
                    report.append(f"    - {issue}")
        report.append("")

        # Summary
        report.append("SUMMARY:")
        report.append(f"  Total files: {results['summary']['total_files']}")
        report.append(f"  Accessible URLs: {results['summary']['accessible_urls']}")
        report.append(f"  Failed URLs: {results['summary']['failed_urls']}")
        report.append(f"  Metadata issues: {results['summary']['metadata_issues']}")

        return "\n".join(report)


async def main():
    """Main execution function"""
    # Configuration
    BUCKET_NAME = os.getenv('GCS_BUCKET_NAME', 'imagine-this-printed-main')
    PROJECT_ID = os.getenv('GOOGLE_CLOUD_PROJECT', 'imagine-this-printed-main')

    if not BUCKET_NAME:
        logger.error("GCS_BUCKET_NAME environment variable is required")
        sys.exit(1)

    try:
        async with ImageStorageVerifier(BUCKET_NAME, PROJECT_ID) as verifier:
            # Run comprehensive check
            results = await verifier.run_comprehensive_check()

            # Generate and display report
            report = verifier.generate_report(results)
            print(report)

            # Save results to file
            output_file = f"image_storage_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, default=str)

            logger.info(f"Detailed results saved to: {output_file}")

            # Exit with error code if critical issues found
            if not results['bucket_exists']:
                sys.exit(1)
            elif results['summary']['failed_urls'] > 0:
                logger.warning("Some URLs are not accessible")
                sys.exit(2)
            else:
                logger.info("All checks passed successfully")

    except Exception as e:
        logger.error(f"Verification failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
