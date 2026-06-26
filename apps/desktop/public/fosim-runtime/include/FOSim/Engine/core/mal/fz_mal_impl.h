#pragma once

#include "fz_marg_base_impl.h"
#include <memory>
#include <string>
#include <vector>

struct FZMalImplPrivate;

/**
 * \brief MAL数据容器
 * 可以存放仿真中使用的大部分数据的容器，拥有以数据类型与数据名称确定唯一数据的特性
 */

class FOSIMENGINE_API FZMalImpl
{
public:
    struct Deleter
    {
        void operator()(FZMalImpl *mal) const noexcept
        {
            delete mal;
        }
    };
    using Ptr = std::unique_ptr<FZMalImpl, Deleter>;

    /**
     * \brief 默认构造函数
     */
    FZMalImpl();
    
    /**
     * \brief 拷贝构造函数
     */
    FZMalImpl(const FZMalImpl &_mal_impl);
    
    /**
     * \brief 移动构造函数
     */
    FZMalImpl(FZMalImpl &&_mal_impl);
    
    /**
     * \brief 拷贝赋值运算符
     */
    FZMalImpl &operator=(const FZMalImpl &_mal_impl);
    ~FZMalImpl();

public:
    /**
     * \brief 创建MAL
     * 静态方法，创建一个新的MAL实例
     * 
     * \return 返回新生成的MAL指针，内存由调用者管理
     *
     * \warning 这是裸指针兼容入口。调用方必须使用 delete 或 DestroyMAL()
     *          释放对象；MalDestroy() 只清空参数内容，不会释放 MAL 容器本身。
     *          新增引擎代码优先使用 CreateMALPtr()。
     */
    static FZMalImpl *CreateMAL();
    /**
     * \brief 创建 MAL 并记录诊断分配点。
     *
     * 仅在 FOSIM_ENABLE_RUNTIME_DIAGNOSTICS 开启时保存 file/line/function；
     * 正式构建下该接口退化为 CreateMAL()，不编译分配点 map/mutex/字符串。
     */
    static FZMalImpl *CreateMALAt(const char *file, int line, const char *function);
    /**
     * \brief 创建由 RAII 管理的 MAL。
     *
     * 适合引擎和模型侧本地同步临时 MAL，调用方无需手写 delete；跨 tick 的通信
     * 或异步 payload 仍应由 message/inter clone，或在所有权明确时 release 给接管方。
     */
    static Ptr CreateMALPtr();

    /**
     * \brief 释放裸指针 MAL 并置空。
     *
     * 这是旧代码过渡用的明确释放入口，和 MalDestroy() 的“只清内容”
     * 语义分离，避免恢复历史 delete-this 造成双删。
     */
    static void DestroyMAL(FZMalImpl *&mal);

    /**
     * \brief 返回当前进程内存活的 MAL 对象数，供测试和 profiler 诊断。
     */
    static size_t AliveCount();

    /**
     * \brief 构造当前仍存活 MAL 的分配点摘要。
     *
     * 诊断开启时按 file:line:function 聚合 live count，便于定位哪条路径开辟
     * MAL 后没有释放；诊断关闭时返回空字符串。
     */
    static std::string BuildAliveAllocationSummary(size_t max_sites = 8);

public:
    /**
     * \fn std::vector<FZMargBaseImpl*>& FZMalImpl::GetMargList()const;
     *
     * \brief 获取内部存储的MargBase列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 列表的引用，当修改返回值时会改变MAL内部数据
     */

    std::vector<FZMargBaseImpl *> GetMargList() const;

    /**
     * \fn void FZMalImpl::SetMargList(const std::vector<FZMargBaseImpl*> & _fz_marg_impl_list);
     *
     * \brief 设置新的MargBase列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \param _fz_marg_impl_list list中MargBase指针由该MAL维护
     */

    void SetMargList(const std::vector<FZMargBaseImpl *> &_fz_marg_impl_list);

public:
    /**
     * \fn virtual FZMalImpl FZMalImpl::*Clone();
     *
     * \brief 深拷贝当前MAL创建一个相同的MAL
     *
     * \author 
     * \date 2020/4/7
     *
     * \return 新拷贝出的MAL
     */

    FZMalImpl *Clone();

public:
    /**
     * \fn FZRC FZMalImpl::AddAddress(char *_name, void *_value);
     *
     * \brief 添加地址数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，MargBase的值
     *
     * \return 输入为空返回失败，否则返回成功
     */

    FZRC AddAddress(const char *_name, void *_value);

    /**
     * \fn void* FZMalImpl::GetAddress(const char *_name);
     *
     * \brief 获取地址数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name 数据输入，MargBase的名称
     *
     * \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的地址
     */

    void *GetAddress(const char *_name);

    /**
	* \fn FZRC GetAddress(const char *_name, void *&_value);
	*
	* \brief 获取地址数据
	*
	* \author 
	* \date 2020/4/7
	*
	* \param [in] _name 数据输入，MargBase的名称
	*
	* \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的地址
	*/

    FZRC GetAddress(const char *_name, void *&_value);
    /**
     * \fn FZRC FZMalImpl::AddMal(char *_name, FZMalImpl* _value);
     *
     * \brief 添加Mal到当前MAL中
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，MargBase的值
     *
     * \return 输入为空返回失败，否则返回成功
     */

    FZRC AddMal(const char *_name, FZMalImpl *_value);

    /**
     * \fn FZMalImpl* FZMalImpl::GetMal(const char *_arg_name);
     *
     * \brief 获取Mal指针
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _arg_name 数据输入，MargBase的名称
     *
     * \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的MAL地址
     */

    FZMalImpl *GetMal(const char *_arg_name);

    /**
	* \fn FZRC GetMal(const char *_arg_name, FZMalImpl *&_value);
	*
	* \brief 获取Mal指针
	*
	* \author 
	* \date 2020/4/7
	*
	* \param [in] _arg_name 数据输入，MargBase的名称
	*
	* \return 不存在对应的MargBase返回空指针，否则返回MargBase中存储的MAL地址
	*/
    FZRC GetMal(const char *_arg_name, FZMalImpl *&_value);
    /**
     * \fn FZRC FZMalImpl::AddTaskIdList(const char* _name, FZTaskIDType &_value);
     *
     * \brief 追加任务id列表
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in] _name  数据输入，MargBase的名称
     * \param [in] _value 数据输入，在对应的TaskId列表中追加
     *
     * \return 输入为空返回失败，否则返回成功
     */

    FZRC AddTaskIdList(const char *_name, const FZTaskIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTaskIdList(const char *_name,size_t _index, FZTaskIDType &_value);
     *
     * \brief 依据名称与索引获取任务id
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in]       _name 数据输入，MargBase的名称
     * \param            _index 数据索引
     * \param [out]      _value 数据输出
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    FZRC GetTaskIdList(const char *_name, size_t _index, FZTaskIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTaskIdListSize(const char *_name, size_t &_size);
     *
     * \brief 获取对应名称中任务id列表中id的数量
     *
     * \author 
     * \date 2020/4/7
     *
     * \param [in]   _name 数据输入，MargBase的名称
     * \param [out]  _size 数据输出，输入名称任务id的数量
     *
     * \return 输入不存在返回失败，否则返回成功
     */

    FZRC GetTaskIdListSize(const char *_name, size_t &_size);

    /**
     * \fn FZRC FZMalImpl::AddBoolean(const char * _name, const FZBOOL& _value);
     *
     * \brief 添加布尔类型
     *
     * \author 
     * \date 2020/4/7
     *
     * \param    _name  数据输入，MargBase的名称
     * \param    _value 数据输入，布尔类型的值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddBoolean(const char *_name, const FZBOOL &_value);

    /**
     * \fn FZRC FZMalImpl::GetBoolean(const char *_arg_name, FZBOOL& _value);
     *
     * \brief 获取布尔类型
     *
     * \author 
     * \date 2020/4/7
     *
     * \param _arg_name 数据输入，MargBase的名称
     * \param _value    数据输出，布尔类型的值
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    FZRC GetBoolean(const char *_arg_name, FZBOOL &_value);

    FZBOOL GetBoolean(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddCoordinate(const char *_name, const FZCoordinateType& _value);
     *
     * \brief 添加纬经度
     *
     * \author 
     * \date 2020/4/7
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输入，纬经度类型的值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddCoordinate(const char *_name, const FZCoordinateType &_value);

    /**
     * \fn FZRC FZMalImpl::GetCoordinate(const char *_arg_name, FZCoordinateType& _value);
     *
     * \brief 获取纬经度
     *
     * \author 
     * \date 2020/4/7
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，纬经度类型的值
     *
     * \return 输入不存在返回失败，否则返回成功。
     */

    FZRC GetCoordinate(const char *_arg_name, FZCoordinateType &_value);
    FZCoordinateType GetCoordinate(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddDMGRC(const char *_name, const FZDMGRC& _value);
     *
     * \brief 添加损伤数据
     *
     * \author 
     * \date 2020/4/7
     *
     * \param        _name  数据输入，MargBase的名称
     * \param        _value 数据输入，损伤类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddDMGRC(const char *_name, const FZDMGRC &_value);

    /**
     * \fn FZRC FZMalImpl::GetDMGRC(const char *_arg_name, FZDMGRC& _value);
     *
     * \brief 获取损伤数据
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，损伤类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetDMGRC(const char *_arg_name, FZDMGRC &_value);
    FZDMGRC GetDMGRC(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddEngagementInfo(const char *_name, const FZEngagementInfoType& _value);
     *
     * \brief 添加约定信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，约定信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddEngagementInfo(const char *_name, const FZEngagementInfoType &_value);

    /**
     * \fn FZRC FZMalImpl::GetEngagementInfo(const char *_arg_name, FZEngagementInfoType& _value);
     *
     * \brief 获取约定信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，约定信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetEngagementInfo(const char *_arg_name, FZEngagementInfoType &_value);
    FZEngagementInfoType GetEngagementInfo(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddEquipmentID(const char *_name, const FZEntityIDType& _value);
     *
     * \brief 添加装备ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，装备ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddEquipmentID(const char *_name, const FZEntityIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetEquipmentID(const char *_arg_name, FZEntityIDType& _value);
     *
     * \brief 获取装备ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，装备ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetEquipmentID(const char *_arg_name, FZEntityIDType &_value);
    FZEntityIDType GetEquipmentID(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddEntityID(const char *_name, const FZEntityIDType& _value);
     *
     * \brief 添加挂载ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，挂载ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddEntityID(const char *_name, const FZEntityIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetEntityID(const char *_arg_name, FZEntityIDType& _value);
     *
     * \brief 获取挂载ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，挂载ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetEntityID(const char *_arg_name, FZEntityIDType &_value);
    FZEntityIDType GetEntityID(const char *_arg_name, FZRC *_res = nullptr);

    /**
	* \fn FZRC AddInterID(const char *_name, const FZInterIDType& _value);
	*
	* \brief 添加交互ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，整数数值
	*
	* \return 输入为空返回失败，否则返回成功。
	*/
    FZRC AddInterID(const char *_name, const FZInterIDType &_value);

    /**
	* \fn FZRC FZMalImpl::GetInterID(const char *_arg_name, FZInterIDType& _value);
	*
	* \brief 获取交互ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param  _arg_name 数据输入，MargBase的名称
	* \param  _value    数据输出，特征ID
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    FZRC GetInterID(const char *_arg_name, FZInterIDType &_value);
    FZInterIDType GetInterID(const char *_arg_name, FZRC *_res = nullptr);

    /**
	* \fn FZRC FZMalImpl::AddFeatureID(const char *_name, const FZFeatureIDType& _value);
	*
	* \brief 添加特征ID
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，整数数值
	*
	* \return 输入为空返回失败，否则返回成功。
	*/
    FZRC AddFeatureID(const char *_name, const FZFeatureIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetFeatureID(const char *_arg_name, FZFeatureIDType& _value);
     *
     * \brief 获取特征ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，特征ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetFeatureID(const char *_arg_name, FZFeatureIDType &_value);
    FZFeatureIDType GetFeatureID(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddInteger(const char *_name, const FZIntegerType& _value);
     *
     * \brief 添加整数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，整数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddInteger(const char *_name, const FZIntegerType &_value);

    /**
     * \fn FZRC FZMalImpl::GetInteger(const char *_arg_name, FZIntegerType& _value);
     *
     * \brief 获取整数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，整数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetInteger(const char *_arg_name, FZIntegerType &_value);
    FZIntegerType GetInteger(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddJulian(const char *_name, const FZJulianType& _value);
     *
     * \brief 添加朱利安时间
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，朱利安时间
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddJulian(const char *_name, const FZJulianType &_value);

    /**
     * \fn FZRC FZMalImpl::GetJulian(const char *_arg_name, FZJulianType& _value);
     *
     * \brief 获取朱利安时间
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，朱利安时间
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetJulian(const char *_arg_name, FZJulianType &_value);
    FZJulianType GetJulian(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddReal(const char *_name, const FZRealType& _value);
     *
     * \brief 添加实数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，实数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddReal(const char *_name, const FZRealType &_value);

    /**
     * \fn FZRC FZMalImpl::GetReal(const char *_arg_name, FZRealType& _value);
     *
     * \brief 获取实数
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，实数数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetReal(const char *_arg_name, FZRealType &_value);
    FZRealType GetReal(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddName(const char *_name,const char* _value);
     *
     * \brief 添加名字
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输入，名称字符串
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddName(const char *_name, const char *_value);

    /**
     * \fn FZRC FZMalImpl::GetName(const char *_arg_name, const char* _name);
     *
     * \brief 获取名称
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _name     数据输出，名称字符串
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetName(const char *_arg_name, char *_name);
    const char *GetName(const char *_arg_name);

    /**
     * \fn FZRC FZMalImpl::AddPosition(char *_name, const FZPositionType& _value);
     *
     * \brief 添加XYZ坐标
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，坐标数值
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddPosition(const char *_name, const FZPositionType &_value);

    /**
     * \fn FZRC FZMalImpl::GetPosition(const char *_arg_name, FZPositionType& _value);
     *
     * \brief 获取XYZ坐标
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，XYZ坐标
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetPosition(const char *_arg_name, FZPositionType &_value);
    FZPositionType GetPosition(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddTrackHandle(const char *_name, const FZTrackHandleType& _value);
     *
     * \brief 添加航迹
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddTrackHandle(const char *_name, const FZTrackHandleType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTrackHandle(const char *_arg_name, FZTrackHandleType& _value);
     *
     * \brief 获取航迹
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetTrackHandle(const char *_arg_name, FZTrackHandleType &_value);

    /**
     * \fn FZRC FZMalImpl::AddTrackID(const char *_name, const FZTrackIDType& _value);
     *
     * \brief 添加航迹ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddTrackID(const char *_name, const FZTrackIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTrackID(const char *_name, FZTrackIDType& _value);
     *
     * \brief 获取航迹ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _value 数据输出，航迹ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetTrackID(const char *_name, FZTrackIDType &_value);
    FZTrackIDType GetTrackID(const char *_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddUnitID(const char *_name, const FZEntityIDType& _value);
     *
     * \brief 添加单元ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，单元ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddUnitID(const char *_name, const FZEntityIDType &_value);

    /**
     * \fn FZRC FZMalImpl::GetUnitID(char *_arg_name, FZEntityIDType& _value);
     *
     * \brief 获取单元ID
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，单元ID
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetUnitID(const char *_arg_name, FZEntityIDType &_value);
    FZEntityIDType GetUnitID(const char *_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddVector(char *_name, const FZVectorType& _value);
     *
     * \brief 添加矢量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，矢量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddVector(const char *_name, const FZVectorType &_value);

    /**
     * \fn FZRC GetOrientation(char *_arg_name, FZOrientationType& _value);
     *
     * \brief 获取矢量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name 数据输入，MargBase的名称
     * \param  _value    数据输出，矢量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetOrientation(const char *_arg_name, FZOrientationType &_value);
    FZOrientationType GetOrientation(const char *_arg_name, FZRC *_res = nullptr);
    /**
	* \fn FZRC AddOrientation(char *_name, const FZOrientationType& _value);
	*
	* \brief 添加矢量
	*
	* \author 
	* \date 2020/4/8
	*
	* \param          _name  数据输入，MargBase的名称
	* \param          _value 数据输入，矢量
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    FZRC AddOrientation(const char *_name, const FZOrientationType &_value);

    /**
	* \fn FZRC FZMalImpl::GetVector(char *_arg_name, FZVectorType& _value);
	*
	* \brief 获取矢量
	*
	* \author 
	* \date 2020/4/8
	*
	* \param  _arg_name 数据输入，MargBase的名称
	* \param  _value    数据输出，矢量
	*
	* \return 输入为空返回失败，否则返回成功。
	*/

    FZRC GetVector(const char *_arg_name, FZVectorType &_value);

    FZVectorType GetVector(const char *_arg_name, FZRC *_res = nullptr);

    /**
     * \fn FZRC FZMalImpl::AddString(char *_name, const char* _value);
     *
     * \brief 添加字符串
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，输入字符串内存不由MAL管理
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddString(const char *_name, const char *_value);

    /**
     * \fn const char* FZMalImpl::GetString(char *_arg_name);
     *
     * \brief 获取字符串，返回值生命周期和MAL相同
     *
     * \author 
     * \date 2020/4/8
     *
     * \param _arg_name 数据输入，MargBase的名称
     *
     * \return 如果不存在返回空指针，否则返回字符指针。
     */

    const char *GetString(const char *_arg_name);

    /**
	* \fn FZRC GetString(char *_arg_name, char* &_value);
	*
	* \brief 获取字符串，返回值生命周期和MAL相同
	*
	* \author 
	* \date 2020/4/8
	*
	* \param _arg_name 数据输入，MargBase的名称
	*
	* \return 如果不存在返回空指针，否则返回字符指针。
	*/

    FZRC GetString(const char *_arg_name, char *&_value);

    /**
     * \fn FZRC FZMalImpl::AddTrackHandleList(char *_name, const FZTrackHandleType& _value);
     *
     * \brief 追加航迹列表
     *
     * \author 
     * \date 2020/4/8
     *
     * \param          _name  数据输入，MargBase的名称
     * \param          _value 数据输入，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddTrackHandleList(const char *_name, const FZTrackHandleType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTrackHandleList(char *_name, size_t _index, FZTrackHandleType& _value);
     *
     * \brief 根据索引与名称获取航迹信息
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name  数据输入，MargBase的名称
     * \param  _index 数据输入，航迹信息的索引
     * \param  _value 数据输出，航迹信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetTrackHandleList(const char *_name, size_t _index, FZTrackHandleType &_value);

    /**
     * \fn FZRC FZMalImpl::GetTrackHandleListSize(char *_name, size_t& _size);
     *
     * \brief 根据名称获取目标航迹列表的数量
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name 数据输入，MargBase的名称
     * \param  _size 数据输出，航迹列表数量
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetTrackHandleListSize(const char *_name, size_t &_size);

    /**
     * \fn FZRC FZMalImpl::AddRecord(char *_name, void *_record, size_t _record_size, FZRecordIDType _record_id = 0);
     *
     * \brief 添加Record
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name        数据输入，MargBase的名称
     * \param  _record      数据输入，Record数据指针
     * \param  _record_size 数据输入，Record结构体大小
     * \param  _record_id   数据输入，Record结构体ID（现在没有用到）
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddRecord(const char *_name, void *_record, size_t _record_size, FZRecordIDType _record_id = 0);

    /**
     * \fn FZRC FZMalImpl::GetRecord(char *_name, void *_record, size_t &_record_size, FZRecordIDType &_record_id);
     *
     * \brief 获取Record
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _name        数据输入，MargBase的名称
     * \param  _record      数据输出，存储Record数据的首地址
     * \param  _record_size 数据输出，Record数据的大小
     * \param  _record_id   数据输出，Record数据的ID（现在没有用到，默认为0）
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC GetRecord(const char *_name, void *_record, size_t &_record_size, FZRecordIDType &_record_id);

    /**
     * \fn FZRC FZMalImpl::AppendMal(FZMalImpl *_mal_value,FZBOOL _override = FZBOOL::FZ_FALSE);
     *
     * \brief 把目标MAL中数据添加到当前MAL中
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _mal_value 数据输出
     * \param  _override  是否覆盖相同数据
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddPODData(const char *_name, void *_pod_data, size_t _pod_data_size);

    FZRC GetPODData(const char *_name, void *_pod_data, size_t &_pod_data_size);

    FZRC AppendMal(FZMalImpl *_mal_value);

    /**
     * \fn FZRC FZMalImpl::MalDestroy();
     *
     * \brief 清空当前MAL内容
     *
     * 历史版本曾把 MalDestroy() 当作对象析构入口使用，容易造成调用方
     * 不清楚自己是否还拥有 FZMalImpl 指针。新版生命周期规则固定为：
     * MalDestroy() 只删除内部参数列表，不释放 FZMalImpl 对象本身；通过
     * CreateMAL/new 得到的对象必须由明确 owner 使用 delete 释放。
     *
     * \return 清理成功返回 FZ_SUCCESS，否则返回 FZ_FAILURE。
     */

    FZRC MalDestroy();

    /**
     * \brief 清空参数并保留对象壳以便复用。
     */
    FZRC ResetForReuse();

    /**
     * \fn FZRC FZMalImpl::AddArgument(FZMargBaseImpl *_margs);
     *
     * \brief 添加一个MargBase, 输入MargBase的生命周期由MAL维护
     *
     * \author 
     * \date 2020/4/8
     *
     * \param _margs 数据输入，要存储的MargBase
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC AddArgument(FZMargBaseImpl *_margs);

    /**
     * \fn FZRC FZMalImpl::DropArgument(FZMargBaseImpl *_marg_value);
     *
     * \brief 根据输入MargBase的名称与类型，删除一个MargBase。MAL中存储的对应数据会被销毁。
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _marg_value 数据输入，要销毁的MargBase信息
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC DropArgument(FZMargBaseImpl *_marg_value);

    FZRC DropArgumentByName(const char *_name, FZMARGType _marg_type);
    /**
     * \fn FZRC FZMalImpl::DropArgumentList();
     *
     * \brief 清除MAL中所有的数据
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZRC DropArgumentList();

    /**
     * \fn FZMargBaseImpl FZMalImpl::*GetArgumentByName(char *_arg_name, FZMARGType _arg_type);
     *
     * \brief 通过名称与类型获取MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _arg_name MargBase 的名称
     * \param  _arg_type MargBase 的类型
     *
     * \return 输入为空返回失败，否则返回成功。
     */

    FZMargBaseImpl *GetArgumentByName(const char *_arg_name, FZMARGType _arg_type);

    /**
     * \fn FZMargBaseImpl FZMalImpl::*GetFirstArgument();
     *
     * \brief 获取第一个MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 如果MAL中存储的MargBase数量是零，返回空指针。
     */

    FZMargBaseImpl *GetFirstArgument();
    FZMargBaseImpl *GetLastArgument();
    /**
     * \fn FZMargBaseImpl FZMalImpl::*GetNextArgument(FZMargBaseImpl *_current_arg);
     *
     * \brief 根据上一个MargBase获取下一个MargBase
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _current_arg 上一个MargBase
     *
     * \return 如果输入为空或输入不存在MAL中或输入是最后一个MargBase返回空指针，否则返回下一个MargBase
     */

    FZMargBaseImpl *GetNextArgument(FZMargBaseImpl *_current_arg);

    FZMargBaseImpl *GetPreviousArgument(FZMargBaseImpl *_current_arg);
    /**
     * \fn size_t FZMalImpl::GetSerializeSize();
     *
     * \brief 获取序列化后的数据大小
     *
     * \author 
     * \date 2020/4/8
     *
     * \return 序列化数据大小
     */

    size_t GetSerializeSize();

    /**
     * \fn FZRC FZMalImpl::SerializeMal(void **_ptr, size_t &_size,size_t _pre_malloc_size = 1);
     *
     * \brief 序列化当前MAL
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _ptr             数据输出，序列化数据指针的地址
     * \param  _size            数据输出，序列化数据的大小
     * \param  _pre_malloc_size 预分配内存，默认大小为1
     *
     * \return 输入为空返回失败，否则返回成功
     */

    FZRC SerializeMal(void **_ptr, size_t &_size, size_t _pre_malloc_size = 1);

    /**
     * \fn FZRC FZMalImpl::DeSerializeMal(void *_ptr, size_t _real_size);
     *
     * \brief 反序列化当前MAL
     *
     * \author 
     * \date 2020/4/8
     *
     * \param  _ptr       数据输入，原始数据
     * \param  _real_size 数据输入，原始数据的大小
     *
     * \return 输入为空或数据错误返回失败。
     */

    FZRC DeSerializeMal(void *_ptr, size_t _real_size);

private:
    size_t GetSerializeSize(FZMalImpl *_mal);
    size_t Serialize(const FZMalImpl *_mal, void *_ptr);
    FZRC DeSerialize(FZMalImpl *_mal, const void *_ptr, size_t _real_size);

private:
    FZMalImplPrivate *fz_mal_impl_private_;
};

#if defined(FOSIM_ENABLE_RUNTIME_DIAGNOSTICS)
#define FOSIM_CREATE_MAL() FZMalImpl::CreateMALAt(__FILE__, __LINE__, __FUNCTION__)
#else
#define FOSIM_CREATE_MAL() FZMalImpl::CreateMAL()
#endif
