from django.test import TestCase, override_settings


@override_settings(DEBUG=False)
class AdminStaticTest(TestCase):
    """운영 설정(DEBUG=False)에서도 관리자 페이지 CSS가 내려와야 한다"""

    def test_admin_css_served(self):
        r = self.client.get('/admin/static/admin/css/base.css')
        self.assertEqual(r.status_code, 200)
        self.assertIn('text/css', r['Content-Type'])

    def test_login_page_links_css(self):
        r = self.client.get('/admin/login/')
        self.assertContains(r, '/admin/static/admin/css/base.css')
