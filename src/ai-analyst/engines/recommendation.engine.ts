export interface OperationalMetrics {
  totalOrders: number;
  successOrders: number;
  failedOrders: number;
  successRate: number;
  totalCodCollected: number;
  totalGrossRevenue: number;
  totalPlatformRevenue: number;
  totalDriverPayout: number;
  deliveredCount: number;
  peakDay?: string;
  peakValue?: number;
  isPeakAbnormal?: boolean;
  topDriversCount?: number;
  topCustomersCount?: number;
}

export type RecommendationCategory = 'OPERATIONS' | 'REVENUE' | 'CUSTOMERS' | 'FLEET';
export type RecommendationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RecommendationItem {
  id: string;
  category: RecommendationCategory;
  categoryLabel: string;
  priority: RecommendationPriority;
  title: string;
  description: string;
  actionableStep: string;
  impact: string;
  iconType: string;
}

export class RecommendationEngine {
  /**
   * Hệ chuyên gia dựa trên luật (Rule-Based Expert System)
   * Phân tích các chỉ số vận hành thực tế và đề xuất 3-4 chiến lược hành động cụ thể
   */
  static generateRecommendations(metrics: OperationalMetrics): RecommendationItem[] {
    const recommendations: RecommendationItem[] = [];

    // ──────────────── 1. QUẢN TRỊ VẬN HÀNH & ĐỈNH TẢI (OPERATIONS) ────────────────
    if (metrics.isPeakAbnormal && metrics.peakDay) {
      recommendations.push({
        id: 'rec_peak_load',
        category: 'OPERATIONS',
        categoryLabel: 'Vận hành & Điều phối',
        priority: 'HIGH',
        title: `Tăng cường năng lực giao vận ngày ${metrics.peakDay}`,
        description: `Dữ liệu phát hiện ${metrics.peakDay} thường xuyên đạt đỉnh tải (${metrics.peakValue ?? 0} đơn). Nguy cơ quá tải cục bộ và trễ cam kết giao hàng (SLA) rất cao.`,
        actionableStep: `Bố trí thêm 2-3 tài xế dự phòng cho khung giờ cao điểm ngày ${metrics.peakDay} và ưu tiên phân cụm VRP sớm hơn 30 phút.`,
        impact: 'Giảm 25% tỷ lệ giao trễ hạn, giữ vững SLA 98% cho khách hàng.',
        iconType: 'AlertCircle',
      });
    } else if (metrics.successRate < 90 && metrics.totalOrders > 0) {
      recommendations.push({
        id: 'rec_improve_success_rate',
        category: 'OPERATIONS',
        categoryLabel: 'Vận hành & Điều phối',
        priority: 'HIGH',
        title: 'Tối ưu hóa quy trình xác nhận địa chỉ trước khi giao',
        description: `Tỷ lệ giao thành công hiện tại đạt ${metrics.successRate}% với ${metrics.failedOrders} đơn thất bại. Phần lớn đơn hỏng xuất phát từ địa chỉ khó tìm hoặc người nhận vắng mặt.`,
        actionableStep:
          'Kích hoạt tin nhắn Zalo ZNS / SMS tự động thông báo trước khi tài xế xuất phát 15 phút và kiểm tra toạ độ định vị trên bản đồ VRP.',
        impact:
          'Kỳ vọng nâng tỷ lệ giao thành công lên trên 95%, tiết kiệm chi phí giao lại (re-delivery).',
        iconType: 'CheckCircle2',
      });
    } else {
      recommendations.push({
        id: 'rec_standard_operations',
        category: 'OPERATIONS',
        categoryLabel: 'Vận hành & Điều phối',
        priority: 'MEDIUM',
        title: 'Duy trì tỷ lệ hoàn tất đơn hàng cao',
        description: `Hệ thống duy trì tỷ lệ thành công ấn tượng ở mức ${metrics.successRate}%. Hiệu suất điều phối các tuyến đường đang hoạt động rất trơn tru.`,
        actionableStep:
          'Tiếp tục áp dụng thuật toán tối ưu hóa đa điểm dừng VRP để rút ngắn thời gian di chuyển giữa các trạm dừng.',
        impact: 'Tiết kiệm thêm 10-15% quãng đường di chuyển và chi phí nhiên liệu.',
        iconType: 'TrendingUp',
      });
    }

    // ──────────────── 2. TỐI ƯU DOANH THU & CHÍNH SÁCH CƯỚC (REVENUE) ────────────────
    if (metrics.totalGrossRevenue > 0) {
      recommendations.push({
        id: 'rec_revenue_optimization',
        category: 'REVENUE',
        categoryLabel: 'Doanh thu & Tài chính',
        priority: 'HIGH',
        title: 'Chính sách chiết khấu 15% và quỹ thưởng hiệu suất',
        description: `Doanh thu nền tảng đạt ${metrics.totalPlatformRevenue.toLocaleString('vi-VN')} ₫ (15% tổng cước). Phần chi trả tài xế là ${metrics.totalDriverPayout.toLocaleString('vi-VN')} ₫ (85%).`,
        actionableStep:
          'Trích 2% từ doanh thu nền tảng để lập quỹ thưởng tuần cho Top tài xế hoàn thành trên 50 đơn với đánh giá 5 sao.',
        impact:
          'Tăng 20% mức độ gắn kết của đối tác tài xế và giảm tình trạng từ chối nhận đơn giờ cao điểm.',
        iconType: 'DollarSign',
      });
    }

    // ──────────────── 3. QUẢN TRỊ RỦI RO DÒNG TIỀN COD (CUSTOMERS) ────────────────
    if (metrics.totalCodCollected > 50000000) {
      recommendations.push({
        id: 'rec_cod_risk_management',
        category: 'CUSTOMERS',
        categoryLabel: 'Dòng tiền & Khách hàng',
        priority: 'HIGH',
        title: 'Siết chặt hạn mức thu nộp COD theo ca làm việc',
        description: `Tổng tiền thu hộ COD thu trong kỳ rất lớn: ${metrics.totalCodCollected.toLocaleString('vi-VN')} ₫. Rủi ro tồn đọng tiền mặt và thất thoát khi tài xế giữ tiền qua ngày.`,
        actionableStep:
          'Thiết lập hạn mức giữ tiền tối đa 10.000.000 ₫/tài xế; khi vượt ngưỡng yêu cầu nộp tiền về Hub trung gian trước khi tiếp tục nhận đơn mới.',
        impact: 'Giảm 99% rủi ro chiếm dụng hoặc thất thoát tiền thu hộ COD.',
        iconType: 'ShieldCheck',
      });
    } else {
      recommendations.push({
        id: 'rec_customer_loyalty',
        category: 'CUSTOMERS',
        categoryLabel: 'Khách hàng & Đối tác',
        priority: 'MEDIUM',
        title: 'Xây dựng gói cước ưu đãi cho Top Khách hàng thân thiết',
        description:
          'Tập trung chăm sóc nhóm khách hàng có lượng đơn mua thường xuyên để gia tăng giá trị trọn đời (LTV).',
        actionableStep:
          'Tặng mã freeship hoặc giảm 10% phí cước cho khách hàng có từ 10 đơn hoàn tất trong tháng.',
        impact: 'Tăng 30% tần suất gửi hàng định kỳ và giảm chi phí tìm kiếm khách hàng mới.',
        iconType: 'Users',
      });
    }

    // ──────────────── 4. CÂN BẰNG TẢI ĐỘI XE (FLEET) ────────────────
    recommendations.push({
      id: 'rec_fleet_balance',
      category: 'FLEET',
      categoryLabel: 'Đội xe & Tài xế',
      priority: 'MEDIUM',
      title: 'Tối ưu phân phối đơn hàng, tránh quá tải tài xế chủ lực',
      description:
        'Dữ liệu cho thấy các tài xế trong Top đầu đang gánh hơn 50% khối lượng giao dịch, trong khi tài xế mới có ít đơn.',
      actionableStep:
        'Điều chỉnh thuật toán chia đơn thông minh trong VRP để cân bằng khối lượng theo bán kính địa lý và trạng thái trực tuyến.',
      impact:
        'Đảm bảo sức khỏe cho đội ngũ tài xế, giảm tỷ lệ nghỉ việc và nâng cao độ phủ toàn khu vực.',
      iconType: 'Truck',
    });

    return recommendations.slice(0, 4);
  }
}
